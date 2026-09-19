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

  it("reads a replay summary with its per-write detail", () => {
    const data = {
      type: "QUEUE_REPLAYED",
      sent: 1,
      dropped: 1,
      pending: 0,
      writes: [
        { method: "POST", url: "https://app.test/api/posts", fate: "sent", status: 201 },
        { method: "DELETE", url: "https://app.test/api/posts/7", fate: "rejected", status: 409 },
      ],
    };
    expect(parseWorkerMessage(data)).toEqual({
      type: "QUEUE_REPLAYED",
      sent: 1,
      dropped: 1,
      pending: 0,
      writes: [
        { method: "POST", url: "https://app.test/api/posts", fate: "sent", status: 201 },
        { method: "DELETE", url: "https://app.test/api/posts/7", fate: "rejected", status: 409 },
      ],
    });
  });

  it("keeps a write that carries no status", () => {
    // `expired` and `exhausted` never saw a response, so there is no status to
    // carry. `exactOptionalPropertyTypes` means the absent case has to be an
    // absent key rather than an explicit `undefined`.
    const parsed = parseWorkerMessage({
      type: "QUEUE_REPLAYED",
      sent: 0,
      dropped: 1,
      pending: 0,
      writes: [{ method: "PUT", url: "/api/posts/3", fate: "exhausted" }],
    });
    expect(parsed).toEqual({
      type: "QUEUE_REPLAYED",
      sent: 0,
      dropped: 1,
      pending: 0,
      writes: [{ method: "PUT", url: "/api/posts/3", fate: "exhausted" }],
    });
    expect(parsed).not.toHaveProperty("writes.0.status");
  });

  it("reads a summary from a worker that sends no detail as counts with no writes", () => {
    /*
      The version-skew case, and the reason `writes` is `readonly T[] | null`
      rather than `readonly T[]`.

      A worker from the previous build controls every open tab until the new
      one claims them, and it answers `REPLAY_QUEUE` in the old shape. The
      counts still have to be believed — something was sent, something may
      have been lost — and `null` is what tells the consumer it cannot
      reconcile per-entry and must fall back to invalidating everything. An
      empty array would say the opposite and say it silently.
    */
    expect(parseWorkerMessage({ type: "QUEUE_REPLAYED", sent: 2, dropped: 1, pending: 0 })).toEqual(
      {
        type: "QUEUE_REPLAYED",
        sent: 2,
        dropped: 1,
        pending: 0,
        writes: null,
      },
    );
  });

  it("rejects the whole list when one write is malformed", () => {
    // All-or-nothing on purpose: a partial list is indistinguishable from a
    // complete one at the consumer, which would invalidate only the entries it
    // could parse and leave the rest quietly stale.
    const parsed = parseWorkerMessage({
      type: "QUEUE_REPLAYED",
      sent: 2,
      dropped: 0,
      pending: 0,
      writes: [
        { method: "POST", url: "/api/posts", fate: "sent", status: 201 },
        { method: "POST", url: "/api/posts", fate: "teleported" },
      ],
    });
    expect(parsed).toEqual({
      type: "QUEUE_REPLAYED",
      sent: 2,
      dropped: 0,
      pending: 0,
      writes: null,
    });
  });

  it.each([
    ["a missing method", { url: "/api/posts", fate: "sent" }],
    ["a non-string url", { method: "POST", url: 7, fate: "sent" }],
    ["a non-numeric status", { method: "POST", url: "/api/posts", fate: "sent", status: "201" }],
    ["a null row", null],
  ])("falls back to no detail for %s", (_case, write) => {
    expect(
      parseWorkerMessage({
        type: "QUEUE_REPLAYED",
        sent: 1,
        dropped: 0,
        pending: 0,
        writes: [write],
      }),
    ).toMatchObject({ writes: null });
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
  it("counts what left the queue and names each write that did", () => {
    const report: ReplayReport = {
      remaining: 1,
      outcomes: [
        { kind: "sent", id: 1, status: 201, method: "POST", url: "/api/posts" },
        { kind: "sent", id: 2, status: 204, method: "DELETE", url: "/api/posts/4" },
        {
          kind: "dropped",
          id: 3,
          reason: "rejected",
          status: 422,
          method: "PUT",
          url: "/api/posts/9",
        },
        { kind: "retry", id: 4, attempts: 1, nextAttemptAt: 0 },
      ],
    };
    expect(summariseReplay(report)).toEqual({
      type: "QUEUE_REPLAYED",
      sent: 2,
      dropped: 1,
      pending: 1,
      writes: [
        { method: "POST", url: "/api/posts", fate: "sent", status: 201 },
        { method: "DELETE", url: "/api/posts/4", fate: "sent", status: 204 },
        { method: "PUT", url: "/api/posts/9", fate: "rejected", status: 422 },
      ],
    });
  });

  it("omits the status where there was no response", () => {
    const report: ReplayReport = {
      remaining: 0,
      outcomes: [
        { kind: "dropped", id: 1, reason: "exhausted", method: "POST", url: "/api/posts" },
        { kind: "dropped", id: 2, reason: "expired", method: "POST", url: "/api/posts" },
      ],
    };
    expect(summariseReplay(report)).toEqual({
      type: "QUEUE_REPLAYED",
      sent: 0,
      dropped: 2,
      pending: 0,
      writes: [
        { method: "POST", url: "/api/posts", fate: "exhausted" },
        { method: "POST", url: "/api/posts", fate: "expired" },
      ],
    });
  });

  it("reports nothing for a pass where every entry is still queued", () => {
    // `retry` and `deferred` mean "unchanged, still waiting", which the
    // `pending` count already says. Reporting them as a third category would
    // make a caller that invalidates on any write fire for a write that has
    // not happened.
    const report: ReplayReport = {
      remaining: 2,
      outcomes: [
        { kind: "retry", id: 1, attempts: 2, nextAttemptAt: 10_000 },
        { kind: "deferred", id: 2, nextAttemptAt: 20_000 },
      ],
    };
    expect(summariseReplay(report)).toEqual({
      type: "QUEUE_REPLAYED",
      sent: 0,
      dropped: 0,
      pending: 2,
      writes: [],
    });
  });

  it("summarises an empty pass", () => {
    expect(summariseReplay({ remaining: 0, outcomes: [] })).toEqual({
      type: "QUEUE_REPLAYED",
      sent: 0,
      dropped: 0,
      pending: 0,
      writes: [],
    });
  });
});
