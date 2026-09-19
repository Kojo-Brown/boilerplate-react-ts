import { APP_SHELL_URL, RUNTIME_CACHE_MAX_ENTRIES } from "@/shared/offline/config";
import type { Route } from "@/shared/offline/routing";
import {
  appShell,
  cacheFirst,
  staleWhileRevalidate,
  trimCache,
  type CacheLike,
  type FetchLike,
  type StrategyResult,
} from "@/shared/offline/strategies";
import type { QueueStore } from "@/shared/offline/queueStore";
import {
  enqueueWrite,
  queuedResponse,
  replayQueue,
  type ReplayPolicy,
  type ReplayReport,
} from "@/shared/offline/syncQueue";
import { parseClientMessage, summariseReplay, type WorkerMessage } from "@/shared/offline/messages";

/**
 * Everything the handlers need from the service worker, as an object.
 *
 * This is the seam that makes the worker testable. `src/app/sw/sw.ts` is
 * excluded from coverage for the same reason `src/app/main.tsx` is — it can
 * only run inside a real service worker, which jsdom does not have — so the
 * rule it follows is that nothing may live there except the construction of
 * this environment and the four `addEventListener` calls that pass it to the
 * functions below. Every decision the worker makes is here, where a test can
 * hand it a fake cache and a fetch that fails.
 */
export interface WorkerEnvironment {
  /** Opens a named cache. `CacheStorage.open` satisfies this. */
  readonly openCache: (name: string) => Promise<CacheLike>;
  readonly fetch: FetchLike;
  /** Opened lazily: a worker woken for a `fetch` should not pay for IndexedDB. */
  readonly store: () => Promise<QueueStore>;
  readonly now: () => number;
  /** Posts to every page this worker can reach. */
  readonly notify: (message: WorkerMessage) => Promise<void>;
  /** Asks the browser to wake the worker when connectivity returns. */
  readonly requestSync: () => Promise<void>;
  readonly precacheName: string;
  readonly runtimeCacheName: string;
  readonly policy?: ReplayPolicy;
}

/** The routes that produce a response. */
export type ReadRoute = Extract<Route, "app-shell" | "precached-asset" | "runtime-cache">;

/**
 * Answers a read with the strategy `routing.ts` chose.
 *
 * The runtime cache is trimmed as part of the revalidation rather than on a
 * timer, because a worker has no timers that survive it being terminated. The
 * trim is chained onto `done` so it is covered by the same `waitUntil` the
 * revalidation is, and so it never delays the response.
 */
export async function handleRead(
  env: WorkerEnvironment,
  route: ReadRoute,
  request: Request,
): Promise<StrategyResult> {
  if (route === "app-shell") {
    const cache = await env.openCache(env.precacheName);
    return appShell({ cache, request, fetch: env.fetch, shellUrl: APP_SHELL_URL });
  }
  if (route === "precached-asset") {
    const cache = await env.openCache(env.precacheName);
    return cacheFirst({ cache, request, fetch: env.fetch });
  }
  const cache = await env.openCache(env.runtimeCacheName);
  const result = await staleWhileRevalidate({ cache, request, fetch: env.fetch });
  return {
    ...result,
    done: result.done.then(() => trimCache(cache, RUNTIME_CACHE_MAX_ENTRIES)),
  };
}

/**
 * Sends a write, or queues it if the network is not there.
 *
 * Only a *thrown* fetch queues. A response — any response, including a 500 —
 * means the server was reached and had an opinion, and replacing that opinion
 * with a synthetic `202` would tell the user their write is pending when the
 * server has already rejected it. The line is "did this request get an answer",
 * not "was the answer good", and it is the only line the worker can draw
 * without knowing what the endpoint means.
 */
export async function handleWrite(env: WorkerEnvironment, request: Request): Promise<Response> {
  try {
    return await env.fetch(request.clone());
  } catch {
    const store = await env.store();
    const entry = await enqueueWrite(store, request, env.now());
    // Best-effort: Background Sync is unimplemented in Safari and Firefox, and
    // is refused in Chromium when the user has blocked background
    // synchronisation. The queue still drains — `REPLAY_QUEUE` from a page
    // that has come back online is the path that does not depend on it.
    await env.requestSync().catch(() => undefined);
    await env.notify({ type: "QUEUE_STATUS", pending: await store.count() });
    return queuedResponse(entry);
  }
}

/**
 * One replay chain per worker environment.
 *
 * A `WeakMap` rather than a module-level variable so two environments — a test
 * running several, a worker that somehow built two — cannot serialise against
 * each other, and so nothing has to be reset between tests.
 */
const replayChain = new WeakMap<WorkerEnvironment, Promise<unknown>>();

/**
 * Drains the queue and tells every open page what happened.
 *
 * **Passes are serialised, and that is a correctness fix rather than a
 * politeness.** Coming back online produces more triggers than one: the
 * browser's own `online` event and the page's `REPLAY_QUEUE` that follows it,
 * a Background Sync firing around the same moment, a second tab doing the same.
 * Run concurrently, each pass reads the queue before any of them has removed
 * anything, so a single queued write is fetched several times and — the part a
 * user sees — reported as several. An `e2e` run against a server that refuses
 * the write showed one lost change announced as three.
 *
 * The idempotency key means the duplicate *sends* were always safe at the
 * server; nothing made the duplicate *reports* safe, and "3 changes could not
 * be saved" for one change is the kind of wrong that costs a user an afternoon
 * looking for the other two.
 *
 * Serialised rather than coalesced: a later caller's pass still runs, it just
 * runs after the one in flight, so the `ignoreBackoff` a page asked for is
 * honoured exactly as asked rather than being folded into somebody else's
 * options. The redundant passes are cheap — an empty queue is one count — and
 * the chain is bounded by the number of connectivity events, not by the size
 * of the queue.
 *
 * Returns the report so the `sync` handler can decide whether to reject — see
 * `sw.ts`, where a non-empty queue is signalled to the browser by rejecting the
 * event, which is how Background Sync is asked to try again later.
 */
export function replayAndNotify(
  env: WorkerEnvironment,
  options: { readonly ignoreBackoff?: boolean } = {},
): Promise<ReplayReport> {
  const previous = replayChain.get(env) ?? Promise.resolve();
  const pass = previous.then(() => runReplayPass(env, options));
  // The link stored for the *next* caller swallows failures. Chaining the raw
  // promise would let one rejected pass reject every replay that ever followed
  // it on this worker, which is a queue that stops draining for the lifetime of
  // the worker with nothing to say why.
  replayChain.set(
    env,
    pass.catch(() => undefined),
  );
  return pass;
}

async function runReplayPass(
  env: WorkerEnvironment,
  options: { readonly ignoreBackoff?: boolean },
): Promise<ReplayReport> {
  const store = await env.store();
  const report = await replayQueue({
    store,
    fetch: env.fetch,
    now: env.now(),
    ...(env.policy !== undefined ? { policy: env.policy } : {}),
    ...(options.ignoreBackoff === true ? { ignoreBackoff: true } : {}),
  });
  await env.notify(summariseReplay(report));
  return report;
}

/**
 * Handles one message from a page.
 *
 * `skipWaiting` is not called here. It is the one message whose effect is on
 * the worker's own lifecycle rather than on the queue, and the lifecycle lives
 * in `sw.ts` — so this returns the decision and lets the caller act on it,
 * which is also what makes the branch testable.
 */
export async function handleMessage(
  env: WorkerEnvironment,
  data: unknown,
  reply: (message: WorkerMessage) => void,
): Promise<"skip-waiting" | "handled" | "ignored"> {
  const message = parseClientMessage(data);
  if (message === null) return "ignored";

  if (message.type === "SKIP_WAITING") return "skip-waiting";

  if (message.type === "QUEUE_STATUS") {
    const store = await env.store();
    reply({ type: "QUEUE_STATUS", pending: await store.count() });
    return "handled";
  }

  // `REPLAY_QUEUE` is sent by a page that has just seen `online` fire, so it
  // carries information the backoff schedule does not have: the network is
  // back. Waiting out a backoff step in front of a user who is watching, on a
  // connection that works, is the schedule being wrong rather than careful.
  await replayAndNotify(env, { ignoreBackoff: true });
  return "handled";
}
