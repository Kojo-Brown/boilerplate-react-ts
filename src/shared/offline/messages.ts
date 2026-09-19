import type { ReplayReport } from "@/shared/offline/syncQueue";

/**
 * The message protocol between the page and the worker.
 *
 * `postMessage` carries `unknown` in both directions, and both ends are a
 * trust boundary in the direction that matters: the worker outlives the page
 * that installed it, so a page running the previous build can send a message
 * the current worker has never heard of, and a worker from the previous build
 * can answer a page that no longer understands the answer. Parsing rather than
 * casting is what keeps that a no-op instead of a `TypeError` in a handler
 * nobody is watching.
 */

/** Page → worker. */
export type ClientMessage =
  | { readonly type: "SKIP_WAITING" }
  | { readonly type: "QUEUE_STATUS" }
  | { readonly type: "REPLAY_QUEUE" };

/** How a queued write ended. The four exits of {@link ReplayReport}, flattened. */
export type ReplayFate = "sent" | "expired" | "exhausted" | "rejected";

/**
 * One write that left the queue during a replay pass.
 *
 * The page needs both halves. `fate` is what the user is told — only `sent`
 * means the write happened, and the other three mean it never will — and
 * `method`/`url` are what the application's own caches are reconciled against:
 * an entry patched optimistically for a write that was abandoned is showing a
 * change the server never saw, and nothing but the target says which entry
 * that is.
 */
export interface ReplayedWrite {
  readonly method: string;
  readonly url: string;
  readonly fate: ReplayFate;
  /** The response status, where there was a response. Absent for `expired` and `exhausted`. */
  readonly status?: number;
}

/** Worker → page. */
export type WorkerMessage =
  | { readonly type: "QUEUE_STATUS"; readonly pending: number }
  | {
      readonly type: "QUEUE_REPLAYED";
      readonly sent: number;
      readonly dropped: number;
      /**
       * Per-write detail, or `null` from a worker that does not send any.
       *
       * The counts are authoritative and always present; this is the extra
       * that invalidation needs. `null` is not "nothing was replayed" — it is
       * "a previous build's worker answered and did not say what it sent",
       * which happens for exactly as long as a deploy takes to claim every
       * open tab. A consumer that treats `null` as an empty array reconciles
       * nothing in precisely the window where it matters, so the type makes
       * the two cases impossible to confuse.
       */
      readonly writes: readonly ReplayedWrite[] | null;
      readonly pending: number;
    };

const CLIENT_TYPES = new Set(["SKIP_WAITING", "QUEUE_STATUS", "REPLAY_QUEUE"]);
const FATES = new Set<string>(["sent", "expired", "exhausted", "rejected"]);

/** Reads a message from a page, or `null` if it is not one of ours. */
export function parseClientMessage(data: unknown): ClientMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const type = (data as Record<string, unknown>)["type"];
  if (typeof type !== "string" || !CLIENT_TYPES.has(type)) return null;
  return { type } as ClientMessage;
}

/** Reads a message from the worker, or `null` if it is not one of ours. */
export function parseWorkerMessage(data: unknown): WorkerMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const row = data as Record<string, unknown>;
  const pending = row["pending"];
  if (typeof pending !== "number") return null;
  if (row["type"] === "QUEUE_STATUS") return { type: "QUEUE_STATUS", pending };
  if (row["type"] === "QUEUE_REPLAYED") {
    const { sent, dropped } = row;
    if (typeof sent !== "number" || typeof dropped !== "number") return null;
    return { type: "QUEUE_REPLAYED", sent, dropped, writes: parseWrites(row["writes"]), pending };
  }
  return null;
}

/**
 * Reads the per-write detail, or `null` where there is none to read.
 *
 * Deliberately all-or-nothing: a malformed row makes the whole list `null`
 * rather than being skipped. A partial list is the one answer that is worse
 * than no list, because the consumer cannot tell it apart from a complete one
 * and would invalidate exactly the entries it could parse — leaving the rest
 * of the cache stale with nothing to indicate it. `null` is a case the
 * consumer already handles.
 */
function parseWrites(value: unknown): readonly ReplayedWrite[] | null {
  if (!Array.isArray(value)) return null;
  const writes: ReplayedWrite[] = [];
  for (const candidate of value as readonly unknown[]) {
    const write = parseWrite(candidate);
    if (write === null) return null;
    writes.push(write);
  }
  return writes;
}

function parseWrite(value: unknown): ReplayedWrite | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const { method, url, fate, status } = row;
  if (typeof method !== "string" || typeof url !== "string") return null;
  if (typeof fate !== "string" || !FATES.has(fate)) return null;
  if (status !== undefined && typeof status !== "number") return null;
  return {
    method,
    url,
    fate: fate as ReplayFate,
    ...(typeof status === "number" ? { status } : {}),
  };
}

/**
 * Turns a replay pass into the one message a page cares about.
 *
 * Still lossy, and the line has moved by exactly one step. The page is told
 * *which* writes left the queue and how each of them ended; it is not told the
 * attempt counts, the backoff schedule, or anything about the entries that are
 * still waiting. That boundary is the useful one: what left the queue is a
 * fact about the application's data, which the page owns and has to reconcile,
 * while how the queue decides when to try again is policy the page would have
 * to re-implement to say anything about — and would then disagree with the
 * queue the first time the policy changed.
 *
 * `retry` and `deferred` outcomes are dropped here rather than reported as a
 * third category, because both mean "unchanged, still queued", which the
 * `pending` count already says.
 */
export function summariseReplay(report: ReplayReport): WorkerMessage {
  let sent = 0;
  let dropped = 0;
  const writes: ReplayedWrite[] = [];
  for (const outcome of report.outcomes) {
    if (outcome.kind === "sent") {
      sent += 1;
      writes.push({
        method: outcome.method,
        url: outcome.url,
        fate: "sent",
        status: outcome.status,
      });
      continue;
    }
    if (outcome.kind === "dropped") {
      dropped += 1;
      writes.push({
        method: outcome.method,
        url: outcome.url,
        fate: outcome.reason,
        ...(outcome.status !== undefined ? { status: outcome.status } : {}),
      });
    }
  }
  return { type: "QUEUE_REPLAYED", sent, dropped, writes, pending: report.remaining };
}
