import * as Comlink from "comlink";
import type { CsvParseProgress } from "@/shared/lib/csvParser";
import type { CsvParserApi, ParseOutcome } from "@/shared/lib/csvParserApi";

/**
 * The main-thread half of the CSV parser: a small object that owns a worker,
 * translates a main-thread cancellation idiom into one the boundary can carry,
 * and cleans up the things Comlink will not clean up on its own.
 *
 * It takes a factory rather than a `Worker`, and the factory returns a
 * {@link WorkerHandle} rather than a `Worker`, for the same reason the API
 * client in `shared/api` takes a port: jsdom has no `Worker`, so a client that
 * constructs one directly can only ever be tested by mocking the module that
 * constructs it — which tests the mock. A handle is satisfied just as well by
 * one end of a `MessageChannel`, so the tests drive the real Comlink protocol.
 */

/** A worker, or anything that speaks its protocol and can be shut down. */
export interface WorkerHandle {
  readonly endpoint: Comlink.Endpoint;
  /** Stops the worker. Called by {@link CsvParserClient.dispose}. */
  terminate: () => void;
}

export interface ParseRequestOptions {
  readonly onProgress?: (progress: CsvParseProgress) => void;
  /**
   * Cancels the parse.
   *
   * The signal does not cross the boundary — it cannot; it is not
   * structured-cloneable — so the client subscribes on this side and sends a
   * `cancel` message when it fires. The parse then resolves with
   * `{ status: "cancelled" }` rather than rejecting, because a cancellation is
   * an outcome the caller asked for and not a failure.
   */
  readonly signal?: AbortSignal;
  readonly chunkRows?: number;
}

/** A parse that failed inside the worker, re-raised on this thread. */
export class CsvParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CsvParseError";
  }
}

export interface CsvParserClient {
  parse: (text: string, options?: ParseRequestOptions) => Promise<ParseOutcome>;
  /** Terminates the worker. The next `parse` starts a fresh one. */
  dispose: () => void;
}

let jobCounter = 0;

/**
 * Wraps a worker factory in a parsing client.
 *
 * The worker is created on the first `parse`, not here. Starting a thread is
 * not free — a module worker costs a fetch, a parse and a compile — and a page
 * that mounts this hook on a route the user may never interact with should not
 * pay for it. The lab's timings are reported from the second run onwards for
 * the same reason: the first includes worker startup, and reporting that as
 * "parsing" would overstate the pattern's cost by a wide margin.
 */
export function createCsvParserClient(createWorker: () => WorkerHandle): CsvParserClient {
  let handle: WorkerHandle | null = null;
  let remote: Comlink.Remote<CsvParserApi> | null = null;

  const ensureRemote = (): Comlink.Remote<CsvParserApi> => {
    if (remote === null) {
      handle = createWorker();
      remote = Comlink.wrap<CsvParserApi>(handle.endpoint);
    }
    return remote;
  };

  return {
    async parse(text: string, options: ParseRequestOptions = {}): Promise<ParseOutcome> {
      const api = ensureRemote();
      jobCounter += 1;
      const jobId = `csv-${jobCounter}`;

      const onAbort = (): void => {
        void api.cancel(jobId);
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });

      /*
       * `Comlink.proxy` is what makes a callback survive `postMessage`.
       * Without it the argument is structured-cloned like everything else and
       * throws `DataCloneError: () => {} could not be cloned` — at the call
       * site, before the worker has seen anything, which at least fails loudly.
       * The quiet failure is the other one: nothing releases the channel this
       * creates unless the receiving side asks, so the worker releases it in a
       * `finally`. See `releaseIfProxy` in `csvParserApi.ts`.
       */
      const progress =
        options.onProgress === undefined ? undefined : Comlink.proxy(options.onProgress);

      try {
        return await api.parse(
          {
            jobId,
            text,
            ...(options.chunkRows === undefined ? {} : { chunkRows: options.chunkRows }),
          },
          progress,
        );
      } catch (cause) {
        /*
         * Comlink re-throws a worker-side error as a *plain* `Error` carrying
         * the original name, message and stack. The class does not survive:
         * `instanceof CsvHeaderError` is false on this side no matter what the
         * worker threw, and code branching on it silently takes the wrong arm.
         * Re-wrapping here means callers have one type to catch that they can
         * actually catch, with the original hung off `cause`.
         */
        throw new CsvParseError(cause instanceof Error ? cause.message : String(cause), { cause });
      } finally {
        options.signal?.removeEventListener("abort", onAbort);
      }
    },

    dispose(): void {
      // Releasing the wrapper closes this side's port; terminating stops the
      // thread. Both are needed: a released proxy over a live worker leaves the
      // thread running, and a terminated worker behind a live proxy leaves
      // every later call pending forever rather than rejecting.
      remote?.[Comlink.releaseProxy]();
      handle?.terminate();
      remote = null;
      handle = null;
    },
  };
}
