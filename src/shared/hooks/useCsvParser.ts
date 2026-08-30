import { useCallback, useEffect, useRef, useState } from "react";
import type { CsvParseProgress, CsvParseResult } from "@/shared/lib/csvParser";
import {
  createCsvParserClient,
  type CsvParserClient,
  type WorkerHandle,
} from "@/shared/lib/csvParserClient";
import { useStableCallback } from "@/shared/hooks/useStableCallback";

export type CsvParserStatus = "idle" | "parsing" | "complete" | "cancelled" | "failed";

export interface CsvParserState {
  readonly status: CsvParserStatus;
  /** Last progress report of the current or most recent run. */
  readonly progress: CsvParseProgress | null;
  readonly result: CsvParseResult | null;
  readonly error: Error | null;
  /** Wall-clock time from `parse()` to settle, in ms. */
  readonly elapsedMs: number | null;
  /** Rows the worker had finished when a cancellation took effect. */
  readonly cancelledAfterRows: number | null;
}

export interface UseCsvParserOptions {
  /**
   * Rows the worker consumes between yields. Defaults to the parser's own.
   *
   * Worth lowering only for a progress bar that has to move on a small file:
   * a parse that fits in one chunk reports progress exactly once, and that one
   * report races the result and usually loses — the callback is a message hop,
   * the return value is a message hop, and the return value was posted first.
   * The state below is written so that losing that race is harmless.
   */
  readonly chunkRows?: number;
}

export interface UseCsvParserResult {
  readonly state: CsvParserState;
  /** Starts a parse. A run already in flight is cancelled first. */
  readonly parse: (text: string) => void;
  /** Cancels the run in flight. A no-op when nothing is running. */
  readonly cancel: () => void;
  /** Returns to `idle` and drops the last result. */
  readonly reset: () => void;
}

const IDLE_STATE: CsvParserState = {
  status: "idle",
  progress: null,
  result: null,
  error: null,
  elapsedMs: null,
  cancelledAfterRows: null,
};

/**
 * Drives a CSV parser worker from a component.
 *
 * The hook owns three things a component should not have to: the worker's
 * lifetime, the `AbortController` that stands in for a cancel message, and the
 * run token that keeps a superseded parse from overwriting a newer one's
 * result.
 *
 * ## Why the worker is not created in an effect
 *
 * The obvious shape — build the client in a `useEffect`, tear it down in its
 * cleanup — starts a thread on mount for every component that *might* parse
 * something, and under `<StrictMode>` starts one, tears it down, and starts
 * another before the user has done anything. The client here is built on the
 * first `parse()` instead, and the effect exists only to dispose. That is also
 * why the ref is nulled in the cleanup: without it, StrictMode's second mount
 * would find a client whose port has already been closed and whose every call
 * would hang rather than reject.
 *
 * ## Why `createWorker` does not need to be stable
 *
 * It is read through `useStableCallback`, so an inline arrow at the call site
 * costs nothing. A factory that changes identity does not restart the worker —
 * the running one keeps serving until `dispose()`, which is the behaviour a
 * caller wants and the one a dependency array would have got wrong.
 */
export function useCsvParser(
  createWorker: () => WorkerHandle,
  options: UseCsvParserOptions = {},
): UseCsvParserResult {
  const { chunkRows } = options;
  const [state, setState] = useState<CsvParserState>(IDLE_STATE);

  const clientRef = useRef<CsvParserClient | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  /**
   * Increments on every `parse()` and every `reset()`. A callback that finds
   * the token moved on stays silent: two parses started a keystroke apart
   * otherwise resolve in whichever order the worker happens to finish them,
   * and the older result wins about as often as not.
   */
  const runRef = useRef(0);

  const makeWorker = useStableCallback(createWorker);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
      clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, []);

  const parse = useCallback(
    (text: string): void => {
      abortRef.current?.abort();

      const client = (clientRef.current ??= createCsvParserClient(makeWorker));
      const controller = new AbortController();
      abortRef.current = controller;
      runRef.current += 1;
      const run = runRef.current;
      const startedAt = performance.now();

      const isCurrent = (): boolean => mountedRef.current && runRef.current === run;

      setState({
        status: "parsing",
        progress: null,
        result: null,
        error: null,
        elapsedMs: null,
        cancelledAfterRows: null,
      });

      client
        .parse(text, {
          signal: controller.signal,
          ...(chunkRows === undefined ? {} : { chunkRows }),
          onProgress: (progress) => {
            /*
             * Progress is fire-and-forget on the worker side, so a report can
             * arrive after the outcome has already been applied. Guarding on
             * the status as well as the run token keeps a late message from
             * flipping a finished parse back to "parsing".
             */
            if (!isCurrent()) return;
            setState((current) =>
              current.status === "parsing" ? { ...current, progress } : current,
            );
          },
        })
        .then((outcome) => {
          if (!isCurrent()) return;
          const elapsedMs = performance.now() - startedAt;
          setState((current) =>
            outcome.status === "complete"
              ? {
                  status: "complete",
                  progress: current.progress,
                  result: outcome.result,
                  error: null,
                  elapsedMs,
                  cancelledAfterRows: null,
                }
              : {
                  status: "cancelled",
                  progress: current.progress,
                  result: null,
                  error: null,
                  elapsedMs,
                  cancelledAfterRows: outcome.rowsParsed,
                },
          );
        })
        .catch((cause: unknown) => {
          if (!isCurrent()) return;
          setState({
            status: "failed",
            progress: null,
            result: null,
            error: cause instanceof Error ? cause : new Error(String(cause)),
            elapsedMs: performance.now() - startedAt,
            cancelledAfterRows: null,
          });
        });
    },
    [makeWorker, chunkRows],
  );

  const cancel = useCallback((): void => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    runRef.current += 1;
    setState(IDLE_STATE);
  }, []);

  return { state, parse, cancel, reset };
}
