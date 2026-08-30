import * as Comlink from "comlink";
import {
  DEFAULT_CHUNK_ROWS,
  createTransactionParser,
  type CsvParseProgress,
  type CsvParseResult,
} from "@/shared/lib/csvParser";

/**
 * The object a CSV-parsing worker exposes over Comlink.
 *
 * It lives here rather than in the worker entry point on purpose. A worker
 * entry is a module whose only job is to run in a `Worker`, and jsdom has no
 * `Worker` at all — so anything written there is untestable by construction.
 * Everything below is driven in `csvParserApi.test.ts` over a real
 * `MessageChannel`, which is the same Comlink protocol the worker speaks:
 * the same serialisation, the same proxy handling, the same task queue. The
 * only thing the channel does not reproduce is the second thread, and that is
 * the one property a unit test was never going to check.
 */

/** How a parse finished. */
export type ParseOutcome =
  | { readonly status: "complete"; readonly result: CsvParseResult }
  | { readonly status: "cancelled"; readonly rowsParsed: number };

export interface ParseJob {
  /**
   * Identifies the job so `cancel` can name it.
   *
   * Cancellation cannot travel the way it does on the main thread: an
   * `AbortSignal` is not structured-cloneable, so it cannot be an argument, and
   * `Comlink.proxy`ing one would hand the worker a *remote* signal whose
   * `aborted` getter is an async round-trip — unreadable from inside a loop
   * that is not yielding. A job id plus a separate `cancel` call is the shape
   * that survives the boundary. `e2e/worker-parsing.spec.ts` pins the
   * clone failure in a real browser, because jsdom does not reproduce it.
   */
  readonly jobId: string;
  readonly text: string;
  /** Rows consumed between yields. Defaults to {@link DEFAULT_CHUNK_ROWS}. */
  readonly chunkRows?: number;
}

/**
 * A progress callback as the worker sees it.
 *
 * The caller passes `Comlink.proxy(fn)`; what arrives here is a proxy whose
 * calls are messages, so it returns a promise even though the original does
 * not. That is why the return type is `void | Promise<void>` rather than
 * `void`: writing `void` would be a lie about what the worker is holding.
 */
export type ProgressSink = (progress: CsvParseProgress) => void | Promise<void>;

export interface CsvParserApi {
  parse: (job: ParseJob, onProgress?: ProgressSink) => Promise<ParseOutcome>;
  cancel: (jobId: string) => void;
}

export interface CsvParserApiOptions {
  /**
   * How the parse loop yields between chunks. Injected so tests can drive the
   * boundary deterministically; see {@link yieldToTaskQueue} for the default
   * and for why it is not a microtask.
   */
  readonly yieldControl?: () => Promise<void>;
}

/**
 * Yields long enough for queued messages to be delivered.
 *
 * This one line is the whole reason chunking works, and getting it wrong fails
 * silently. `await Promise.resolve()` — or any other microtask — does *not*
 * do this: microtasks drain before the event loop takes its next task, so a
 * `cancel` message sitting in the port's queue is still sitting there after a
 * thousand of them. `csvParserApi.test.ts` runs the loop both ways against a
 * cancel sent immediately: the microtask arm runs to completion having never
 * seen it, the macrotask arm stops after one chunk.
 *
 * `setTimeout(…, 0)` rather than the two obvious alternatives:
 *
 * - `scheduler.yield()` is the modern spelling and is the *wrong* one here. It
 *   resumes the continuation at a priority above newly queued tasks, which is
 *   precisely backwards when the message you are yielding to hear is "stop".
 * - A `MessageChannel` ping avoids the nesting clamp below, but puts the wake-up
 *   in the same task source as Comlink's own traffic, so it competes with the
 *   message it exists to let through.
 *
 * The cost is the HTML spec's clamp: from the fifth nested timer onwards a
 * `setTimeout(0)` waits ~4ms. At {@link DEFAULT_CHUNK_ROWS} that is a few
 * hundred milliseconds across a 200k-row file — real, and the reason the chunk
 * size is thousands of rows rather than tens.
 */
export function yieldToTaskQueue(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** The `[releaseProxy]` method, present only on a value that crossed a port. */
type Releasable = Record<typeof Comlink.releaseProxy, () => void>;

/**
 * Releases a proxied callback, if it is one.
 *
 * The asymmetry here is the part worth remembering: the callback is *created*
 * on the calling thread, but the proxy that has to be released lives on the
 * receiving one. Comlink serialises `Comlink.proxy(fn)` by standing up a
 * `MessageChannel` and shipping one end; nothing ever closes either end unless
 * the receiver asks, so a page that parses twelve files with a progress bar
 * leaks twelve channels — and every closure each one holds — with no error and
 * nothing in the network or memory panels pointing at it.
 *
 * The guard is not defensive coding: `createCsvParserApi()` is also called
 * directly (in tests, and as the in-process arm of the lab), and a plain
 * function has no such method.
 */
function releaseIfProxy(value: unknown): void {
  if (typeof value !== "function") return;
  const release = (value as Partial<Releasable>)[Comlink.releaseProxy];
  if (typeof release === "function") release.call(value);
}

/**
 * Builds the parser API.
 *
 * One instance serves every job; concurrency is bounded by the caller, not
 * here. A worker is a single thread, so two overlapping parses interleave
 * chunk by chunk and each finishes later than it would have alone — the client
 * therefore runs one at a time and this object stays simple.
 */
export function createCsvParserApi(options: CsvParserApiOptions = {}): CsvParserApi {
  const yieldControl = options.yieldControl ?? yieldToTaskQueue;

  const running = new Set<string>();
  const cancelled = new Set<string>();

  return {
    async parse(job: ParseJob, onProgress?: ProgressSink): Promise<ParseOutcome> {
      const chunkRows = job.chunkRows ?? DEFAULT_CHUNK_ROWS;
      running.add(job.jobId);

      try {
        const parser = createTransactionParser(job.text);
        let more = true;

        while (more) {
          if (cancelled.has(job.jobId)) {
            return { status: "cancelled", rowsParsed: parser.progress().rowsParsed };
          }

          more = parser.step(chunkRows);

          if (onProgress !== undefined) {
            /*
             * Deliberately not awaited. A proxied callback is a round trip, so
             * awaiting each one would put two message hops between every pair
             * of chunks and make the progress bar the slowest part of the
             * parse. Fire-and-forget means the last update may land after the
             * result does; the client treats the result as authoritative for
             * exactly that reason.
             */
            void onProgress(parser.progress());
          }

          if (more) await yieldControl();
        }

        const result = parser.result();
        /*
         * The one large value going back, moved rather than copied. Without
         * the transfer the amounts array is structured-cloned — at 200k rows
         * that is another 800KB allocated on each side, after a parse whose
         * entire purpose was to keep work off the receiving thread.
         *
         * Transferring detaches the buffer here: `result.amountsMinor` is
         * length 0 on this side the moment the message is posted. That is fine
         * because `parser` is dead, and it is a real hazard anywhere it is not
         * — pinned in `csvParserApi.test.ts`.
         */
        const outcome: ParseOutcome = { status: "complete", result };
        return Comlink.transfer(outcome, [result.amountsMinor.buffer]);
      } finally {
        running.delete(job.jobId);
        cancelled.delete(job.jobId);
        releaseIfProxy(onProgress);
      }
    },

    cancel(jobId: string): void {
      // An id that is not running is ignored rather than remembered. There is
      // no race to lose: a port delivers messages in order, so a `cancel` the
      // client sent after its `parse` cannot arrive first. Remembering unknown
      // ids instead would give the worker a set that only ever grows.
      if (running.has(jobId)) cancelled.add(jobId);
    },
  };
}

/**
 * Exposes a parser API on `endpoint`.
 *
 * Split out from the worker entry point so that the entry point is one line
 * that cannot be wrong, and so that the wiring itself is exercised by tests
 * against a `MessageChannel`.
 */
export function exposeCsvParser(endpoint: Comlink.Endpoint, options?: CsvParserApiOptions): void {
  Comlink.expose(createCsvParserApi(options), endpoint);
}
