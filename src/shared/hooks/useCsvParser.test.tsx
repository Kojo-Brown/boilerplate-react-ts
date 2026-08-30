import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCsvParser } from "@/shared/hooks/useCsvParser";
import { buildSampleCsv } from "@/shared/lib/sampleCsv";
import { createFakeCsvWorker, type FakeWorker } from "@/test/workerChannel";

function renderParser(options: { strict?: boolean; chunkRows?: number } = {}) {
  const workers: FakeWorker[] = [];
  const createWorker = vi.fn(() => {
    const worker = createFakeCsvWorker();
    workers.push(worker);
    return worker;
  });

  const view = renderHook(
    () =>
      useCsvParser(
        createWorker,
        options.chunkRows === undefined ? {} : { chunkRows: options.chunkRows },
      ),
    { ...(options.strict === true ? { wrapper: StrictMode } : {}) },
  );

  return { ...view, workers, createWorker };
}

describe("useCsvParser", () => {
  it("starts idle and starts no worker", () => {
    const { result, createWorker } = renderParser();

    expect(result.current.state).toEqual({
      status: "idle",
      progress: null,
      result: null,
      error: null,
      elapsedMs: null,
      cancelledAfterRows: null,
    });
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("moves through parsing to complete, carrying the result and a timing", async () => {
    const { result } = renderParser();

    act(() => {
      result.current.parse(buildSampleCsv(600, { seed: 1 }));
    });
    expect(result.current.state.status).toBe("parsing");

    await waitFor(() => {
      expect(result.current.state.status).toBe("complete");
    });
    expect(result.current.state.result?.rowCount).toBe(600);
    expect(result.current.state.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.current.state.error).toBeNull();
  });

  it("records progress from a parse that spans several chunks", async () => {
    const { result } = renderParser({ chunkRows: 200 });

    act(() => {
      result.current.parse(buildSampleCsv(2_000, { seed: 2 }));
    });
    await waitFor(() => {
      expect(result.current.state.status).toBe("complete");
    });

    // Reports that arrived while the parse was in flight are kept alongside the
    // result. Asserting on an intermediate render instead would be a race: the
    // whole parse is a few milliseconds here, and `waitFor` polls.
    expect(result.current.state.progress?.rowsParsed).toBeGreaterThan(0);
  });

  it("does not let a late progress report reopen a single-chunk parse", async () => {
    /*
     * A parse that fits in one chunk reports progress exactly once, and that
     * report loses its race with the result: both are message hops and the
     * result was posted first. So `progress` stays null — and, more to the
     * point, the arriving report does not flip a finished parse back to
     * `parsing` a tick after the caller was told it was done.
     */
    const { result } = renderParser();

    act(() => {
      result.current.parse(buildSampleCsv(50, { seed: 12 }));
    });
    await waitFor(() => {
      expect(result.current.state.status).toBe("complete");
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result.current.state.status).toBe("complete");
    expect(result.current.state.progress).toBeNull();
    expect(result.current.state.result?.rowCount).toBe(50);
  });

  it("cancels the run in flight", async () => {
    const { result } = renderParser();

    act(() => {
      result.current.parse(buildSampleCsv(6_000, { seed: 3 }));
    });
    act(() => {
      result.current.cancel();
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe("cancelled");
    });
    expect(result.current.state.cancelledAfterRows).toBeLessThan(6_000);
    expect(result.current.state.result).toBeNull();
  });

  it("does nothing when cancel is called with nothing running", () => {
    const { result } = renderParser();
    expect(() => {
      act(() => {
        result.current.cancel();
      });
    }).not.toThrow();
    expect(result.current.state.status).toBe("idle");
  });

  it("reports a header failure without throwing at the call site", async () => {
    const { result } = renderParser();

    act(() => {
      result.current.parse("wrong,header\n");
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe("failed");
    });
    expect(result.current.state.error?.message).toMatch(/Expected the header/);
  });

  it("keeps the newer of two overlapping parses", async () => {
    /*
     * Without the run token this is a coin toss. The first parse is cancelled
     * by the second, so it settles *earlier* than the one that replaced it —
     * and a naive implementation would then write "cancelled" over a result
     * that is still on its way.
     */
    const { result } = renderParser();

    act(() => {
      result.current.parse(buildSampleCsv(8_000, { seed: 4 }));
    });
    act(() => {
      result.current.parse(buildSampleCsv(120, { seed: 5 }));
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe("complete");
    });
    expect(result.current.state.result?.rowCount).toBe(120);

    // Give the superseded run every chance to land late.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result.current.state.status).toBe("complete");
    expect(result.current.state.result?.rowCount).toBe(120);
  });

  it("returns to idle on reset and ignores the run it interrupted", async () => {
    const { result } = renderParser();

    act(() => {
      result.current.parse(buildSampleCsv(6_000, { seed: 6 }));
    });
    act(() => {
      result.current.reset();
    });

    expect(result.current.state.status).toBe("idle");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result.current.state.status).toBe("idle");
  });

  it("terminates the worker on unmount", async () => {
    const { result, workers, unmount } = renderParser();

    act(() => {
      result.current.parse(buildSampleCsv(200, { seed: 7 }));
    });
    await waitFor(() => {
      expect(result.current.state.status).toBe("complete");
    });

    unmount();
    expect(workers[0]?.isTerminated()).toBe(true);
  });

  it("reuses one worker across parses", async () => {
    const { result, createWorker } = renderParser();

    act(() => {
      result.current.parse(buildSampleCsv(150, { seed: 8 }));
    });
    await waitFor(() => {
      expect(result.current.state.status).toBe("complete");
    });
    act(() => {
      result.current.parse(buildSampleCsv(150, { seed: 9 }));
    });
    await waitFor(() => {
      expect(result.current.state.result?.rowCount).toBe(150);
    });

    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it("survives StrictMode's mount, unmount, remount", async () => {
    /*
     * The failure this guards against: a client built in an effect is disposed
     * by StrictMode's first cleanup, and the ref still points at it on the
     * second mount — so every later call posts into a closed port and hangs,
     * with no error anywhere. Building lazily and nulling the ref in the
     * cleanup is what makes the second mount start clean.
     */
    const { result, createWorker } = renderParser({ strict: true });

    expect(createWorker).not.toHaveBeenCalled();
    act(() => {
      result.current.parse(buildSampleCsv(300, { seed: 10 }));
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe("complete");
    });
    expect(result.current.state.result?.rowCount).toBe(300);
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it("does not need a stable factory", async () => {
    // An inline arrow at the call site changes identity on every render. It
    // must not restart the worker, and it must not stop `parse` from working.
    const { result, rerender } = renderHook(() => useCsvParser(() => createFakeCsvWorker()));

    rerender();
    act(() => {
      result.current.parse(buildSampleCsv(100, { seed: 11 }));
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe("complete");
    });
  });
});
