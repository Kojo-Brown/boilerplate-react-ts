import { describe, it, expect } from "vitest";
import { captureHeapSnapshot, collectGarbage, type CdpSessionLike } from "./captureSnapshot.ts";

/**
 * A CDP session that streams chunks the way the real one does: from *inside*
 * the `takeHeapSnapshot` call, before it resolves. A fake that emitted them
 * afterwards would let a broken implementation — one that subscribes after
 * awaiting the command — pass.
 */
interface FakeSession extends CdpSessionLike {
  readonly calls: { method: string; params?: Record<string, unknown> }[];
  /** How many chunk handlers are still attached. */
  handlerCount(): number;
}

function fakeSession(options: { chunks?: readonly string[]; failOn?: string }): FakeSession {
  const handlers = new Map<string, Set<(payload: { chunk: string }) => void>>();
  const calls: { method: string; params?: Record<string, unknown> }[] = [];

  return {
    calls,
    handlerCount: () => handlers.get("HeapProfiler.addHeapSnapshotChunk")?.size ?? 0,
    on(event, handler) {
      const set = handlers.get(event) ?? new Set();
      set.add(handler);
      handlers.set(event, set);
    },
    off(event, handler) {
      handlers.get(event)?.delete(handler);
    },
    send(method, params) {
      calls.push(params === undefined ? { method } : { method, params });
      if (method === options.failOn) return Promise.reject(new Error(`${method} failed`));
      if (method === "HeapProfiler.takeHeapSnapshot") {
        for (const chunk of options.chunks ?? []) {
          for (const handler of handlers.get("HeapProfiler.addHeapSnapshotChunk") ?? []) {
            handler({ chunk });
          }
        }
      }
      return Promise.resolve(undefined);
    },
  };
}

describe("captureHeapSnapshot", () => {
  it("joins the streamed chunks into the snapshot text", async () => {
    const session = fakeSession({ chunks: ['{"snapshot"', ':{"meta":{}}', "}"] });

    await expect(captureHeapSnapshot(session)).resolves.toBe('{"snapshot":{"meta":{}}}');
  });

  it("enables the profiler and asks for no progress reporting", async () => {
    const session = fakeSession({ chunks: ["{}"] });

    await captureHeapSnapshot(session);

    expect(session.calls).toEqual([
      { method: "HeapProfiler.enable" },
      {
        method: "HeapProfiler.takeHeapSnapshot",
        params: { reportProgress: false, captureNumericValue: false },
      },
    ]);
  });

  it("asks for numeric values only when told to", async () => {
    const session = fakeSession({ chunks: ["{}"] });

    await captureHeapSnapshot(session, { captureNumericValue: true });

    expect(session.calls[1]?.params).toMatchObject({ captureNumericValue: true });
  });

  it("detaches its chunk handler even when the command fails", async () => {
    const session = fakeSession({ failOn: "HeapProfiler.takeHeapSnapshot" });

    await expect(captureHeapSnapshot(session)).rejects.toThrow("takeHeapSnapshot failed");

    // A leaked handler would append this capture's chunks to the next one's
    // buffer, and the corruption would only show up as unparseable JSON much
    // later, in a different test.
    expect(session.handlerCount()).toBe(0);
  });
});

describe("collectGarbage", () => {
  it("enables the profiler before asking it to collect", async () => {
    const session = fakeSession({});

    await collectGarbage(session);

    expect(session.calls.map((call) => call.method)).toEqual([
      "HeapProfiler.enable",
      "HeapProfiler.collectGarbage",
    ]);
  });
});
