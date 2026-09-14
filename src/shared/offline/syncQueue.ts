import { IDEMPOTENCY_HEADER, QUEUED_HEADER } from "@/shared/offline/config";
import type { FetchLike } from "@/shared/offline/strategies";
import type { NewQueuedRequest, QueuedRequest, QueueStore } from "@/shared/offline/queueStore";

/**
 * The replay policy: how often a queued write is retried, and when it is given
 * up on.
 *
 * Background Sync has its own retry schedule and it is not a substitute for
 * this one. The browser retries the `sync` *event*, with an interval it
 * chooses, and gives up after a handful of attempts — and on the browsers that
 * do not implement Background Sync at all (Safari, Firefox) it never fires
 * once. The queue's own schedule is what makes the behaviour the same
 * everywhere: the event is a hint that now is a good time, not the mechanism.
 */
export interface ReplayPolicy {
  /** Attempts before a write is abandoned. */
  readonly maxAttempts: number;
  /** First backoff step; doubles per attempt. */
  readonly baseDelayMs: number;
  /** Ceiling on the backoff, so a long outage does not push the next attempt past the user's session. */
  readonly maxDelayMs: number;
  /**
   * How long a write may sit in the queue.
   *
   * There is a point past which sending a write is worse than dropping it: a
   * comment posted on a thread that has since been deleted, a cart update from
   * a session that expired, an edit the user made three days ago and has
   * forgotten. A day is the default because it is roughly "since the user last
   * had the application open", and because an unbounded queue eventually
   * replays a request whose auth token expired long ago — producing a 401 that
   * looks like a bug in authentication.
   */
  readonly maxAgeMs: number;
}

export const DEFAULT_REPLAY_POLICY: ReplayPolicy = {
  maxAttempts: 5,
  baseDelayMs: 5_000,
  maxDelayMs: 5 * 60_000,
  maxAgeMs: 24 * 60 * 60 * 1_000,
};

export type ReplayOutcome =
  | { readonly kind: "sent"; readonly id: number; readonly status: number }
  | {
      readonly kind: "dropped";
      readonly id: number;
      readonly reason: "expired" | "exhausted" | "rejected";
      readonly status?: number;
    }
  | {
      readonly kind: "retry";
      readonly id: number;
      readonly attempts: number;
      readonly nextAttemptAt: number;
    }
  | { readonly kind: "deferred"; readonly id: number; readonly nextAttemptAt: number };

export interface ReplayReport {
  readonly outcomes: readonly ReplayOutcome[];
  /** Entries still in the queue when the pass ended. */
  readonly remaining: number;
}

export interface EnqueueOptions {
  /** Injected so a test can assert the stored key rather than match a regex against a UUID. */
  readonly newId?: () => string;
}

/**
 * Serialises a write and stores it.
 *
 * The request is read here, at enqueue time, and never again: `Request` bodies
 * are single-use streams, and a queue that stored the `Request` object would
 * hold something that cannot be replayed and does not survive the worker being
 * terminated.
 *
 * An idempotency key is added when the caller did not supply one, and it is
 * added *once*, before the first attempt. That ordering is the entire point. A
 * key generated at replay time would differ per attempt and buy nothing: the
 * request being retried is one whose response was never seen, so the server
 * may well have processed it already. The same key on every attempt is what
 * lets the server recognise the duplicate — which means this only works
 * against an API that honours the header, and `docs/offline.md` says what to
 * do when yours does not.
 */
export async function enqueueWrite(
  store: QueueStore,
  request: Request,
  now: number,
  options: EnqueueOptions = {},
): Promise<QueuedRequest> {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const headers: [string, string][] = [...request.headers.entries()];
  if (!request.headers.has(IDEMPOTENCY_HEADER)) headers.push([IDEMPOTENCY_HEADER, newId()]);

  // `clone()` so the caller's request is still readable — `sw.ts` hands the
  // same request on to nothing, but a queue that consumes its argument is a
  // trap for the next caller.
  const body = await request.clone().arrayBuffer();

  const entry: NewQueuedRequest = {
    url: request.url,
    method: request.method,
    headers,
    body: body.byteLength > 0 ? body : null,
    queuedAt: now,
    attempts: 0,
    // Immediately eligible: a write is queued because the network failed once,
    // not because it is known to be unavailable, and the first retry should
    // cost nothing if the failure was a dropped connection.
    nextAttemptAt: now,
  };
  return store.add(entry);
}

/**
 * The response the page gets for a write that was queued.
 *
 * `202 Accepted` is the honest status: the request is valid, it has been
 * accepted for processing, and the processing has not happened. The
 * alternatives are both lies with consequences — a `200` tells optimistic UI
 * the write succeeded and leaves the user with a receipt for something that
 * may never be sent, and rethrowing the network error tells them it failed
 * while the worker quietly sends it later.
 *
 * It is still a status application code has to handle. A `202` carrying
 * {@link QUEUED_HEADER} means "pending", and the interface should say so.
 */
export function queuedResponse(entry: QueuedRequest): Response {
  return new Response(JSON.stringify({ queued: true, id: entry.id, queuedAt: entry.queuedAt }), {
    status: 202,
    statusText: "Queued Offline",
    headers: { "content-type": "application/json", [QUEUED_HEADER]: "1" },
  });
}

/** Rebuilds a `Request` from a stored row. */
export function toRequest(entry: QueuedRequest): Request {
  return new Request(entry.url, {
    method: entry.method,
    headers: new Headers(entry.headers.map(([name, value]): [string, string] => [name, value])),
    body: entry.body,
    credentials: "same-origin",
  });
}

/**
 * Sends what the queue holds, oldest first, and stops at the first one that
 * cannot be sent.
 *
 * **Head-of-line blocking is deliberate.** These are writes against one API by
 * one user, and they were issued in an order the user meant: a `PATCH` that
 * renames a report and a `DELETE` that removes it do not commute. Skipping
 * past a failed entry to send a later one is how a queue produces a server
 * state that never existed on the client. The cost is that one permanently
 * failing write delays everything behind it, which is why {@link ReplayPolicy}
 * has both an attempt limit and an age limit: the head is always eventually
 * dropped.
 *
 * The three ways an entry leaves the queue are worth distinguishing, because
 * they mean different things to a user:
 *
 * - **sent** — a 2xx. Gone, done.
 * - **rejected** — a 4xx that is not 408/425/429. The server understood the
 *   request and refused it; a retry produces the same refusal, so retrying is
 *   only a way to take longer to tell the user.
 * - **exhausted / expired** — the write never got an answer and never will.
 *   This is the case that needs surfacing: it is the only one where the user
 *   believes something was saved and nothing was.
 */
export async function replayQueue(options: {
  readonly store: QueueStore;
  readonly fetch: FetchLike;
  readonly now: number;
  readonly policy?: ReplayPolicy;
}): Promise<ReplayReport> {
  const { store, fetch, now } = options;
  const policy = options.policy ?? DEFAULT_REPLAY_POLICY;
  const outcomes: ReplayOutcome[] = [];

  for (const entry of await store.list()) {
    if (now - entry.queuedAt > policy.maxAgeMs) {
      await store.remove(entry.id);
      outcomes.push({ kind: "dropped", id: entry.id, reason: "expired" });
      continue;
    }
    if (entry.nextAttemptAt > now) {
      outcomes.push({ kind: "deferred", id: entry.id, nextAttemptAt: entry.nextAttemptAt });
      break;
    }

    let response: Response;
    try {
      response = await fetch(toRequest(entry));
    } catch {
      outcomes.push(await recordFailure(store, entry, now, policy, undefined));
      // The network just failed. Every entry behind this one would fail the
      // same way, and each attempt would burn one of its five.
      break;
    }

    if (response.ok) {
      await store.remove(entry.id);
      outcomes.push({ kind: "sent", id: entry.id, status: response.status });
      continue;
    }

    if (isRetryable(response.status)) {
      outcomes.push(await recordFailure(store, entry, now, policy, retryAfterMs(response, now)));
      break;
    }

    await store.remove(entry.id);
    outcomes.push({ kind: "dropped", id: entry.id, reason: "rejected", status: response.status });
  }

  return { outcomes, remaining: await store.count() };
}

async function recordFailure(
  store: QueueStore,
  entry: QueuedRequest,
  now: number,
  policy: ReplayPolicy,
  serverDelayMs: number | undefined,
): Promise<ReplayOutcome> {
  const attempts = entry.attempts + 1;
  if (attempts >= policy.maxAttempts) {
    await store.remove(entry.id);
    return { kind: "dropped", id: entry.id, reason: "exhausted" };
  }
  const nextAttemptAt = now + (serverDelayMs ?? backoffMs(attempts, policy));
  await store.update({ ...entry, attempts, nextAttemptAt });
  return { kind: "retry", id: entry.id, attempts, nextAttemptAt };
}

/**
 * Exponential backoff, without jitter.
 *
 * Jitter exists to stop a thundering herd of clients retrying in lockstep, and
 * there is no herd here: each client's clock starts when *its own* request
 * failed. What would synchronise them is the network coming back — which wakes
 * every client at once and is exactly the moment the first attempt is made,
 * before any backoff applies. Jitter on later attempts would not change that,
 * and the server-side fix for it (`Retry-After`, honoured below) does.
 */
export function backoffMs(attempts: number, policy: ReplayPolicy = DEFAULT_REPLAY_POLICY): number {
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempts - 1));
}

/** Statuses where trying the same request again can plausibly succeed. */
export function isRetryable(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * `Retry-After`, in milliseconds from now, or `undefined`.
 *
 * Both spellings are accepted because both are used: a rate limiter emits
 * delta-seconds, and a maintenance window emits an HTTP date. A server that
 * says when to come back is more informed than any local schedule, so this
 * overrides the backoff rather than being combined with it — but only upward
 * of zero; a date in the past means "now", not "immediately and also
 * negatively".
 */
export function retryAfterMs(response: Response, now: number): number | undefined {
  const header = response.headers.get("retry-after");
  if (header === null) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}
