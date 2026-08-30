import { describe, expect, it, vi } from "vitest";
import type { CsvParseProgress } from "@/shared/lib/csvParser";
import { CsvParseError, createCsvParserClient } from "@/shared/lib/csvParserClient";
import { buildSampleCsv } from "@/shared/lib/sampleCsv";
import { createFakeCsvWorker } from "@/test/workerChannel";

const macrotask = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe("createCsvParserClient", () => {
  it("does not start a worker until the first parse", () => {
    const createWorker = vi.fn(() => createFakeCsvWorker());
    const client = createCsvParserClient(createWorker);

    expect(createWorker).not.toHaveBeenCalled();
    client.dispose();
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("reuses one worker across parses", async () => {
    const createWorker = vi.fn(() => createFakeCsvWorker());
    const client = createCsvParserClient(createWorker);

    await client.parse(buildSampleCsv(100, { seed: 1 }));
    await client.parse(buildSampleCsv(100, { seed: 2 }));

    expect(createWorker).toHaveBeenCalledTimes(1);
    client.dispose();
  });

  it("returns the parsed summary", async () => {
    const client = createCsvParserClient(() => createFakeCsvWorker());
    const outcome = await client.parse(buildSampleCsv(500, { seed: 3 }), { chunkRows: 100 });

    expect(outcome.status).toBe("complete");
    if (outcome.status !== "complete") throw new Error("unreachable");
    expect(outcome.result.rowCount).toBe(500);
    expect(outcome.result.amountsMinor).toHaveLength(500);
    client.dispose();
  });

  it("forwards progress without the caller wrapping anything", async () => {
    const client = createCsvParserClient(() => createFakeCsvWorker());
    const seen: CsvParseProgress[] = [];

    await client.parse(buildSampleCsv(400, { seed: 4 }), {
      chunkRows: 100,
      onProgress: (progress) => {
        seen.push(progress);
      },
    });
    await macrotask();

    expect(seen.at(-1)?.rowsParsed).toBe(400);
    client.dispose();
  });

  it("turns an AbortSignal into a cancel the worker can act on", async () => {
    const client = createCsvParserClient(() => createFakeCsvWorker());
    const controller = new AbortController();

    const running = client.parse(buildSampleCsv(5_000, { seed: 5 }), {
      chunkRows: 100,
      signal: controller.signal,
    });
    controller.abort();
    const outcome = await running;

    expect(outcome.status).toBe("cancelled");
    if (outcome.status !== "cancelled") throw new Error("unreachable");
    expect(outcome.rowsParsed).toBeLessThan(5_000);
    client.dispose();
  });

  it("resolves rather than rejects on cancellation", async () => {
    // A cancellation is an outcome the caller asked for. Rejecting would make
    // every call site distinguish it from a failure by inspecting an error.
    const client = createCsvParserClient(() => createFakeCsvWorker());
    const controller = new AbortController();
    const running = client.parse(buildSampleCsv(4_000, { seed: 6 }), {
      chunkRows: 100,
      signal: controller.signal,
    });
    controller.abort();

    await expect(running).resolves.toMatchObject({ status: "cancelled" });
    client.dispose();
  });

  it("ignores a signal aborted after the parse finished", async () => {
    const client = createCsvParserClient(() => createFakeCsvWorker());
    const controller = new AbortController();

    const outcome = await client.parse(buildSampleCsv(100, { seed: 7 }), {
      signal: controller.signal,
    });
    expect(outcome.status).toBe("complete");

    // The listener is removed in a `finally`, so this reaches nothing. Left
    // in because the leak it guards against is per-parse and unbounded: a
    // long-lived signal would otherwise accumulate one listener per file.
    expect(() => {
      controller.abort();
    }).not.toThrow();
    client.dispose();
  });

  it("re-wraps a worker-side failure into a class the caller can catch", async () => {
    /*
     * Comlink reconstructs a thrown error as a plain `Error` carrying the
     * original name and message; the prototype does not survive the boundary.
     * Without this wrapper the only way to recognise a parse failure is to
     * match on `error.name`, which is a string comparison pretending to be a
     * type check.
     */
    const client = createCsvParserClient(() => createFakeCsvWorker());
    let thrown: unknown;
    try {
      await client.parse("wrong,header\n");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CsvParseError);
    expect((thrown as CsvParseError).message).toMatch(/Expected the header/);
    expect((thrown as CsvParseError).cause).toBeInstanceOf(Error);
    expect(((thrown as CsvParseError).cause as Error).name).toBe("CsvHeaderError");
    client.dispose();
  });

  it("terminates the worker and releases the proxy on dispose", () => {
    const worker = createFakeCsvWorker();
    const client = createCsvParserClient(() => worker);

    void client.parse(buildSampleCsv(50, { seed: 8 }));
    client.dispose();

    expect(worker.isTerminated()).toBe(true);
  });

  it("is safe to dispose twice", () => {
    const worker = createFakeCsvWorker();
    const client = createCsvParserClient(() => worker);
    void client.parse(buildSampleCsv(50, { seed: 9 }));

    client.dispose();
    client.dispose();

    // The second call finds nothing to do rather than terminating a worker
    // that is already gone — which in a browser logs nothing but does leave
    // the second `releaseProxy` posting into a closed port.
    expect(worker.terminateCount()).toBe(1);
  });

  it("starts a fresh worker after dispose", async () => {
    const createWorker = vi.fn(() => createFakeCsvWorker());
    const client = createCsvParserClient(createWorker);

    await client.parse(buildSampleCsv(100, { seed: 10 }));
    client.dispose();
    const outcome = await client.parse(buildSampleCsv(100, { seed: 10 }));

    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(outcome.status).toBe("complete");
    client.dispose();
  });

  it("gives concurrent parses distinct job ids", async () => {
    // Two parses sharing an id would let one's cancel stop the other. The
    // counter is module-scoped rather than per-client for exactly that reason:
    // two clients in one page are still two senders on one worker's protocol.
    const worker = createFakeCsvWorker();
    const client = createCsvParserClient(() => worker);
    const controller = new AbortController();

    const cancellable = client.parse(buildSampleCsv(4_000, { seed: 11 }), {
      chunkRows: 100,
      signal: controller.signal,
    });
    const untouched = client.parse(buildSampleCsv(400, { seed: 12 }), { chunkRows: 100 });
    controller.abort();

    expect((await cancellable).status).toBe("cancelled");
    expect((await untouched).status).toBe("complete");
    client.dispose();
  });
});
