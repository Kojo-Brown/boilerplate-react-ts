import { describe, expect, it, vi } from "vitest";
import * as Comlink from "comlink";
import {
  createCsvParserApi,
  exposeCsvParser,
  yieldToTaskQueue,
  type CsvParserApi,
  type CsvParserApiOptions,
} from "@/shared/lib/csvParserApi";
import type { CsvParseProgress } from "@/shared/lib/csvParser";
import { buildSampleCsv } from "@/shared/lib/sampleCsv";
import { parseTransactionsCsv } from "@/shared/lib/csvParser";

/**
 * Every test here talks to the parser through a real `MessageChannel`, which
 * is the same protocol a `Worker` speaks: the same structured cloning, the same
 * proxy handling, the same task queue. What it is not is a second thread — see
 * `src/test/workerChannel.ts` for why that is the right trade for a unit test
 * and where the missing half is covered.
 */
function connect(options: CsvParserApiOptions = {}): {
  remote: Comlink.Remote<CsvParserApi>;
  close: () => void;
} {
  const { port1, port2 } = new MessageChannel();
  exposeCsvParser(port1, options);
  const remote = Comlink.wrap<CsvParserApi>(port2);
  return {
    remote,
    close: () => {
      remote[Comlink.releaseProxy]();
      port1.close();
      port2.close();
    },
  };
}

const macrotask = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe("createCsvParserApi over a port", () => {
  it("returns the same result the in-process parser produces", async () => {
    const text = buildSampleCsv(1_200, { seed: 21, invalidEvery: 50 });
    const expected = parseTransactionsCsv(text);
    const { remote, close } = connect();

    const outcome = await remote.parse({ jobId: "a", text, chunkRows: 300 });

    expect(outcome.status).toBe("complete");
    if (outcome.status !== "complete") throw new Error("unreachable");
    expect(outcome.result.rowCount).toBe(expected.rowCount);
    expect(outcome.result.totalMinor).toBe(expected.totalMinor);
    expect(outcome.result.categories).toEqual(expected.categories);
    expect(outcome.result.errors).toEqual(expected.errors);
    expect(Array.from(outcome.result.amountsMinor)).toEqual(Array.from(expected.amountsMinor));
    close();
  });

  it("delivers progress through a proxied callback", async () => {
    const { remote, close } = connect();
    const seen: CsvParseProgress[] = [];

    await remote.parse(
      { jobId: "b", text: buildSampleCsv(400, { seed: 2 }), chunkRows: 100 },
      Comlink.proxy((progress: CsvParseProgress) => {
        seen.push(progress);
      }),
    );
    await macrotask();

    expect(seen.length).toBeGreaterThanOrEqual(4);
    expect(seen.at(-1)).toMatchObject({ rowsParsed: 400, ratio: 1 });
    // Monotonic: a progress bar that goes backwards is worse than none.
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]?.rowsParsed).toBeGreaterThanOrEqual(seen[i - 1]?.rowsParsed ?? 0);
    }
    close();
  });

  it("rejects a callback that was not wrapped in Comlink.proxy, and the types do not", async () => {
    /*
     * The line below type-checks. That is the finding: `Comlink.Remote<T>`
     * describes a remote method's *parameters* with the local types, so a bare
     * function is a perfectly good `ProgressSink` as far as `tsc` is concerned,
     * and the missing `Comlink.proxy` is a runtime error only. An
     * `@ts-expect-error` here fails the build with "unused directive" — which
     * is how this was discovered.
     *
     * It does at least fail loudly, at the call site, before the worker has
     * seen anything. The message names the function rather than the remedy, so
     * it is recorded here with the remedy attached.
     */
    const { remote, close } = connect();
    await expect(
      remote.parse({ jobId: "c", text: buildSampleCsv(10) }, () => undefined),
    ).rejects.toThrow(/could not be cloned/i);
    close();
  });

  it("throws the header error across the boundary, but not its class", async () => {
    const { remote, close } = connect();
    let thrown: unknown;
    try {
      await remote.parse({ jobId: "d", text: "wrong,header\n" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/Expected the header/);
    // The name survives; the prototype does not. Comlink reconstructs a plain
    // `Error` from a serialised {name, message, stack}, so any code branching
    // on `instanceof CsvHeaderError` takes the wrong arm — silently. This is
    // why `csvParserClient` re-wraps into a class the caller can catch.
    expect((thrown as Error).name).toBe("CsvHeaderError");
    expect(Object.getPrototypeOf(thrown)).toBe(Error.prototype);
    close();
  });
});

describe("cancellation", () => {
  it("stops a running parse when the loop yields to the task queue", async () => {
    const { remote, close } = connect();
    const text = buildSampleCsv(5_000, { seed: 4 });

    const running = remote.parse({ jobId: "e", text, chunkRows: 100 });
    await remote.cancel("e");
    const outcome = await running;

    expect(outcome.status).toBe("cancelled");
    if (outcome.status !== "cancelled") throw new Error("unreachable");
    expect(outcome.rowsParsed).toBeGreaterThan(0);
    expect(outcome.rowsParsed).toBeLessThan(5_000);
    close();
  });

  it("never sees the cancel when the loop only yields a microtask", async () => {
    /*
     * The failure this pins is the reason `yieldToTaskQueue` exists, and it is
     * invisible from the outside: the parse runs to completion, returns a
     * correct result, and the cancel button did nothing. Microtasks drain
     * *before* the event loop takes its next task, so the `cancel` message is
     * still sitting in the port's queue no matter how many of them go by.
     */
    const { remote, close } = connect({ yieldControl: () => Promise.resolve() });
    const text = buildSampleCsv(5_000, { seed: 4 });

    const running = remote.parse({ jobId: "f", text, chunkRows: 100 });
    void remote.cancel("f");
    const outcome = await running;

    expect(outcome.status).toBe("complete");
    if (outcome.status !== "complete") throw new Error("unreachable");
    expect(outcome.result.rowCount).toBe(5_000);
    close();
  });

  it("ignores a cancel for a job that is not running", () => {
    // Ports deliver in order, so a `cancel` the client sent after its `parse`
    // cannot arrive first — which is what lets this be a no-op instead of a
    // set of job ids that only ever grows.
    const api = createCsvParserApi();
    expect(() => {
      api.cancel("never-started");
    }).not.toThrow();
  });

  it("does not carry a cancellation into the next job with the same id", async () => {
    const { remote, close } = connect();
    const text = buildSampleCsv(3_000, { seed: 7 });

    const first = remote.parse({ jobId: "reused", text, chunkRows: 100 });
    await remote.cancel("reused");
    expect((await first).status).toBe("cancelled");

    const second = await remote.parse({ jobId: "reused", text, chunkRows: 1_000 });
    expect(second.status).toBe("complete");
    close();
  });
});

describe("resource handling", () => {
  it("releases the progress callback's port when the job ends", async () => {
    /*
     * The asymmetry worth remembering: the callback is created on the calling
     * side, but the proxy that has to be released lives on the receiving one.
     * Comlink stands up a `MessageChannel` per proxied function and closes
     * neither end unless the receiver asks — so a page that parses twelve
     * files with a progress bar leaks twelve channels, silently.
     *
     * Counting `MessagePort.close()` is the only observable the platform
     * offers here; the alternative is asserting nothing and hoping.
     */
    const closeSpy = vi.spyOn(MessagePort.prototype, "close");
    const { remote, close } = connect();
    const before = closeSpy.mock.calls.length;

    for (let i = 0; i < 3; i += 1) {
      await remote.parse(
        { jobId: `g${String(i)}`, text: buildSampleCsv(50, { seed: i }) },
        Comlink.proxy(() => undefined),
      );
    }
    await macrotask();
    await macrotask();

    expect(closeSpy.mock.calls.length - before).toBe(3);
    close();
    closeSpy.mockRestore();
  });

  it("releases the callback even when the parse throws", async () => {
    const closeSpy = vi.spyOn(MessagePort.prototype, "close");
    const { remote, close } = connect();
    const before = closeSpy.mock.calls.length;

    await expect(
      remote.parse(
        { jobId: "h", text: "nope\n" },
        Comlink.proxy(() => undefined),
      ),
    ).rejects.toThrow();
    await macrotask();
    await macrotask();

    expect(closeSpy.mock.calls.length - before).toBe(1);
    close();
    closeSpy.mockRestore();
  });

  it("tolerates a plain callback when the api is used in-process", async () => {
    // `createCsvParserApi()` is also called directly — by the lab's in-process
    // arm and by tests. A plain function has no `[releaseProxy]`, and reaching
    // for one unguarded would throw at the end of every such parse.
    const api = createCsvParserApi();
    const seen: number[] = [];
    const outcome = await api.parse(
      { jobId: "i", text: buildSampleCsv(200, { seed: 1 }), chunkRows: 50 },
      (progress) => {
        seen.push(progress.rowsParsed);
      },
    );
    expect(outcome.status).toBe("complete");
    expect(seen.at(-1)).toBe(200);
  });

  it("sends the amounts buffer in a transfer list rather than cloning it", async () => {
    const { remote, close } = connect();
    const spy = vi.spyOn(MessagePort.prototype, "postMessage");

    const outcome = await remote.parse({ jobId: "j", text: buildSampleCsv(300, { seed: 12 }) });
    expect(outcome.status).toBe("complete");
    if (outcome.status !== "complete") throw new Error("unreachable");
    expect(outcome.result.amountsMinor).toHaveLength(300);

    // Without the transfer the array still arrives — cloned — and nothing about
    // the result says which happened. The transfer list on the wire does.
    const withTransfer = spy.mock.calls.filter(
      (call) => Array.isArray(call[1]) && call[1].some((t) => t instanceof ArrayBuffer),
    );
    expect(withTransfer.length).toBeGreaterThan(0);

    spy.mockRestore();
    close();
  });

  it("leaves the sending side holding a detached buffer", async () => {
    /*
     * The other half of what a transfer costs, isolated so it can be asserted
     * from both sides at once. The receiver gets the numbers; the sender is
     * left with a zero-length buffer. Harmless here — the parser is dead by the
     * time the message goes out — and a real hazard anywhere it is not.
     */
    const { port1, port2 } = new MessageChannel();
    const kept: { buffer: ArrayBufferLike | null } = { buffer: null };
    Comlink.expose(
      {
        make(): Int32Array {
          const amounts = new Int32Array([11, 22, 33]);
          kept.buffer = amounts.buffer;
          return Comlink.transfer(amounts, [amounts.buffer]);
        },
      },
      port1,
    );
    const remote = Comlink.wrap<{ make: () => Int32Array }>(port2);

    expect(kept.buffer).toBeNull();
    const received = await remote.make();

    expect(Array.from(received)).toEqual([11, 22, 33]);
    expect(kept.buffer?.byteLength).toBe(0);

    remote[Comlink.releaseProxy]();
    port1.close();
    port2.close();
  });
});

describe("yieldToTaskQueue", () => {
  it("resolves on a task, not a microtask", async () => {
    let settled = false;
    const pending = yieldToTaskQueue().then(() => {
      settled = true;
    });

    for (let i = 0; i < 100; i += 1) await Promise.resolve();
    expect(settled).toBe(false);

    await pending;
    expect(settled).toBe(true);
  });
});
