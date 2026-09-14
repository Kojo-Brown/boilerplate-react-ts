import { describe, it, expect } from "vitest";
import { parseClientMessage, parseWorkerMessage, summariseReplay } from "@/shared/offline/messages";
import type { ReplayReport } from "@/shared/offline/syncQueue";

describe("parseClientMessage", () => {
  it.each(["SKIP_WAITING", "QUEUE_STATUS", "REPLAY_QUEUE"])("accepts %s", (type) => {
    expect(parseClientMessage({ type })).toEqual({ type });
  });

  it.each([
    ["a message from another library", { type: "workbox-broadcast" }],
    ["a message with no type", { pending: 2 }],
    ["a string", "SKIP_WAITING"],
    ["null", null],
  ])("ignores %s", (_case, data) => {
    // The worker outlives the page that installed it, so it is routinely
    // handed messages from builds — and from libraries — it has never heard
    // of. Parsing rather than casting is what makes that a no-op.
    expect(parseClientMessage(data)).toBeNull();
  });
});

describe("parseWorkerMessage", () => {
  it("reads a queue status", () => {
    expect(parseWorkerMessage({ type: "QUEUE_STATUS", pending: 3 })).toEqual({
      type: "QUEUE_STATUS",
      pending: 3,
    });
  });

  it("reads a replay summary", () => {
    expect(parseWorkerMessage({ type: "QUEUE_REPLAYED", sent: 2, dropped: 1, pending: 0 })).toEqual(
      {
        type: "QUEUE_REPLAYED",
        sent: 2,
        dropped: 1,
        pending: 0,
      },
    );
  });

  it.each([
    ["a status with no count", { type: "QUEUE_STATUS" }],
    ["a summary missing its counts", { type: "QUEUE_REPLAYED", pending: 0 }],
    ["an unknown type", { type: "SOMETHING_ELSE", pending: 0 }],
    ["a number", 7],
  ])("ignores %s", (_case, data) => {
    expect(parseWorkerMessage(data)).toBeNull();
  });
});

describe("summariseReplay", () => {
  it("counts what left the queue and what was abandoned", () => {
    const report: ReplayReport = {
      remaining: 1,
      outcomes: [
        { kind: "sent", id: 1, status: 201 },
        { kind: "sent", id: 2, status: 204 },
        { kind: "dropped", id: 3, reason: "rejected", status: 422 },
        { kind: "retry", id: 4, attempts: 1, nextAttemptAt: 0 },
      ],
    };
    // Deliberately lossy: a user interface built on the per-entry detail would
    // have to re-implement the replay policy to say anything useful about it.
    expect(summariseReplay(report)).toEqual({
      type: "QUEUE_REPLAYED",
      sent: 2,
      dropped: 1,
      pending: 1,
    });
  });

  it("summarises an empty pass", () => {
    expect(summariseReplay({ remaining: 0, outcomes: [] })).toEqual({
      type: "QUEUE_REPLAYED",
      sent: 0,
      dropped: 0,
      pending: 0,
    });
  });
});
