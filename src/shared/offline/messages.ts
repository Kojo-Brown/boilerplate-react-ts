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

/** Worker → page. */
export type WorkerMessage =
  | { readonly type: "QUEUE_STATUS"; readonly pending: number }
  | {
      readonly type: "QUEUE_REPLAYED";
      readonly sent: number;
      readonly dropped: number;
      readonly pending: number;
    };

const CLIENT_TYPES = new Set(["SKIP_WAITING", "QUEUE_STATUS", "REPLAY_QUEUE"]);

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
    return { type: "QUEUE_REPLAYED", sent, dropped, pending };
  }
  return null;
}

/**
 * Turns a replay pass into the one message a page cares about.
 *
 * Deliberately lossy: the page is told how many writes left and how many were
 * abandoned, not which ones or why. The per-entry detail belongs in the
 * worker's own reasoning — a user interface built on it would have to
 * re-implement the policy to say anything useful, and would then disagree with
 * the queue the first time the policy changed.
 */
export function summariseReplay(report: ReplayReport): WorkerMessage {
  let sent = 0;
  let dropped = 0;
  for (const outcome of report.outcomes) {
    if (outcome.kind === "sent") sent += 1;
    if (outcome.kind === "dropped") dropped += 1;
  }
  return { type: "QUEUE_REPLAYED", sent, dropped, pending: report.remaining };
}
