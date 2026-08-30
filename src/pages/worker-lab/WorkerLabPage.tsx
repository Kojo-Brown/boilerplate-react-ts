import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/shared/ui/Button";
import { useCsvParser, type CsvParserState } from "@/shared/hooks/useCsvParser";
import { createJankMeter, type FrameStats, type JankMeter } from "@/shared/lib/jankMeter";
import { formatMinor, parseTransactionsCsv, type CsvParseResult } from "@/shared/lib/csvParser";
import { buildSampleCsv } from "@/shared/lib/sampleCsv";
import type { WorkerHandle } from "@/shared/lib/csvParserClient";
import { createCsvParserWorker } from "@/shared/workers/createCsvParserWorker";
import {
  ROW_COUNT_OPTIONS,
  SAMPLE_INVALID_EVERY,
  SAMPLE_SEED,
  formatBytes,
  parseParseMode,
  parseRowCount,
  type ParseMode,
  type RowCount,
} from "@/pages/worker-lab/workerLabParams";

/** Chunk size chosen so the progress bar moves even on the 10k sample. */
const LAB_CHUNK_ROWS = 2_000;

export interface WorkerLabPageProps {
  /**
   * How to start the parser worker.
   *
   * Defaulted rather than required, and injected rather than imported, for the
   * reason the whole module chain below it is: jsdom has no `Worker`, so a page
   * that reaches for `new Worker` directly can only be unit-tested by mocking
   * the module that constructs it. The default is the real thing, so the route
   * needs no wiring; the tests pass one end of a `MessageChannel`.
   */
  readonly createWorker?: () => WorkerHandle;
}

interface MainThreadRun {
  readonly result: CsvParseResult;
  readonly elapsedMs: number;
}

/**
 * Harness for parsing a large CSV off the main thread.
 *
 * Both arms run the *same parser* — `parseTransactionsCsv` — over the *same*
 * bytes. The only difference is which thread runs it, and the frame stats are
 * where that difference shows up: the blocking arm produces one frame interval
 * as long as the parse, because `requestAnimationFrame` cannot fire while the
 * thread is inside the loop. Nothing about the result differs, which is the
 * point: this is not a faster parser, it is the same parser somewhere else.
 */
export function WorkerLabPage({ createWorker = createCsvParserWorker }: WorkerLabPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const rowCount = parseRowCount(searchParams.get("rows"));
  const mode = parseParseMode(searchParams.get("mode"));

  const [sample, setSample] = useState<{ rowCount: RowCount; text: string } | null>(null);
  const [mainRun, setMainRun] = useState<MainThreadRun | null>(null);
  const [stats, setStats] = useState<FrameStats | null>(null);

  const meterRef = useRef<JankMeter | null>(null);
  const worker = useCsvParser(createWorker, { chunkRows: LAB_CHUNK_ROWS });

  const setParam = useCallback(
    (key: string, value: string): void => {
      const params = new URLSearchParams(searchParams);
      params.set(key, value);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const clearRun = useCallback((): void => {
    setMainRun(null);
    setStats(null);
    worker.reset();
  }, [worker]);

  const buildSample = (): void => {
    clearRun();
    // Built on demand, and timed separately from the parse. Generating 200k
    // rows is itself hundreds of milliseconds of main-thread work, and folding
    // it into the measurement would credit the worker arm with a saving it did
    // not make.
    setSample({
      rowCount,
      text: buildSampleCsv(rowCount, { seed: SAMPLE_SEED, invalidEvery: SAMPLE_INVALID_EVERY }),
    });
  };

  const startMeter = (): JankMeter => {
    const meter = (meterRef.current ??= createJankMeter());
    setStats(null);
    meter.start();
    return meter;
  };

  const runInWorker = (text: string): void => {
    clearRun();
    startMeter();
    worker.parse(text);
    // Stopped by the effect below, not here: `parse` reports through hook state
    // and has no promise to attach to.
  };

  const runOnMainThread = (text: string): void => {
    clearRun();
    const meter = startMeter();
    /*
     * Two frames of delay before blocking. The first lets React commit the
     * "parsing" state; the second lets the browser actually paint it. Without
     * them the whole interaction — click, commit, parse — happens inside one
     * task and the UI never shows a parsing state at all, which would make the
     * blocking arm look *better* than it is.
     */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const startedAt = performance.now();
        const result = parseTransactionsCsv(text);
        const elapsedMs = performance.now() - startedAt;
        setMainRun({ result, elapsedMs });
        /*
         * One more frame before stopping, and this is not tidiness. The meter
         * samples on `requestAnimationFrame`, so the interval that *contains*
         * the parse is only measurable once a frame is produced after it —
         * stopping here instead would discard the long gap and report a worst
         * frame of about 16ms, making the blocking arm look indistinguishable
         * from the worker one. Found by writing it the other way first.
         */
        requestAnimationFrame(() => {
          setStats(meter.stop());
        });
      });
    });
  };

  /*
   * Closes the recording when the worker arm settles.
   *
   * An effect rather than a ref written during render, and rather than polling
   * `requestAnimationFrame` for a status: both of those need to read a value
   * that changes after the closure was created, and a ref assigned in the
   * component body is the Rules of React violation `react-hooks/refs` reports —
   * a render React throws away still leaves its write behind. The status *is*
   * a dependency, so an effect keyed on it is the honest spelling.
   */
  const workerStatus = worker.state.status;
  useEffect(() => {
    const meter = meterRef.current;
    if (meter === null || !meter.isRecording()) return;
    if (workerStatus === "parsing") return;
    setStats(meter.stop());
  }, [workerStatus]);

  const result = mode === "worker" ? worker.state.result : (mainRun?.result ?? null);
  const elapsedMs = mode === "worker" ? worker.state.elapsedMs : (mainRun?.elapsedMs ?? null);
  const isParsing = mode === "worker" && worker.state.status === "parsing";

  return (
    <main className="flex flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Web Worker Lab</h1>
        <p className="max-w-2xl text-[var(--color-muted-fg)]">
          The same CSV parser over the same bytes, run two ways. Watch the frame stats rather than
          the elapsed time: parsing off the main thread is not faster, it just stops being the
          reason the page has frozen.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2" role="group" aria-label="Sample size">
          {ROW_COUNT_OPTIONS.map((option) => (
            <Button
              key={option}
              variant={rowCount === option ? "primary" : "ghost"}
              aria-pressed={rowCount === option}
              onClick={() => {
                setParam("rows", String(option));
              }}
            >
              {option.toLocaleString()} rows
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2" role="group" aria-label="Parsing thread">
          <Button
            variant={mode === "worker" ? "primary" : "ghost"}
            aria-pressed={mode === "worker"}
            onClick={() => {
              setParam("mode", "worker");
            }}
          >
            Worker
          </Button>
          <Button
            variant={mode === "main" ? "primary" : "ghost"}
            aria-pressed={mode === "main"}
            onClick={() => {
              setParam("mode", "main");
            }}
          >
            Main thread
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={buildSample} data-testid="build-sample">
          Build sample
        </Button>

        <Button
          disabled={sample === null || isParsing}
          data-testid="run-parse"
          onClick={() => {
            if (sample === null) return;
            if (mode === "worker") runInWorker(sample.text);
            else runOnMainThread(sample.text);
          }}
        >
          {mode === "worker" ? "Parse in worker" : "Parse on main thread"}
        </Button>

        <Button
          variant="ghost"
          disabled={!isParsing}
          data-testid="cancel-parse"
          onClick={worker.cancel}
        >
          Cancel
        </Button>

        <span data-testid="sample-summary" className="text-sm text-[var(--color-muted-fg)]">
          {sample === null
            ? "No sample built yet."
            : `${sample.rowCount.toLocaleString()} rows · ${formatBytes(sample.text.length)}`}
        </span>
      </div>

      <p className="max-w-2xl text-sm text-[var(--color-muted-fg)]">
        Cancel is enabled in the worker arm only, and that is not an oversight: a blocking parse
        occupies the thread that would have to handle the click, so between pressing{" "}
        <strong>Parse on main thread</strong> and seeing a result there is no moment at which any
        button can be pressed at all.
      </p>

      <ParseStatus mode={mode} worker={worker.state} mainElapsedMs={mainRun?.elapsedMs ?? null} />

      <FrameStatsPanel stats={stats} />

      <ResultPanel result={result} elapsedMs={elapsedMs} />
    </main>
  );
}

interface ParseStatusProps {
  mode: ParseMode;
  worker: CsvParserState;
  mainElapsedMs: number | null;
}

function ParseStatus({ mode, worker, mainElapsedMs }: ParseStatusProps) {
  if (mode === "main") {
    return (
      <p data-testid="parse-status" data-status={mainElapsedMs === null ? "idle" : "complete"}>
        {mainElapsedMs === null ? "Idle." : "Parsed on the main thread."}
      </p>
    );
  }

  const percent = Math.round((worker.progress?.ratio ?? 0) * 100);

  return (
    <div className="flex flex-col gap-2">
      <p data-testid="parse-status" data-status={worker.status}>
        {worker.status === "idle" && "Idle."}
        {worker.status === "parsing" && `Parsing in the worker — ${String(percent)}%`}
        {worker.status === "complete" && "Parsed in the worker."}
        {worker.status === "cancelled" &&
          `Cancelled after ${(worker.cancelledAfterRows ?? 0).toLocaleString()} rows.`}
        {worker.status === "failed" && `Failed: ${worker.error?.message ?? "unknown error"}`}
      </p>
      <div
        className="h-2 w-full max-w-md overflow-hidden rounded-full bg-[var(--color-muted)]"
        role="progressbar"
        aria-label="Parse progress"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full bg-[var(--color-primary)] transition-[width] duration-100"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
    </div>
  );
}

interface FrameStatsPanelProps {
  stats: FrameStats | null;
}

function FrameStatsPanel({ stats }: FrameStatsPanelProps) {
  if (stats === null) {
    return (
      <p data-testid="frame-stats-empty" className="text-sm text-[var(--color-muted-fg)]">
        No recording yet — build a sample and run a parse.
      </p>
    );
  }

  return (
    <dl
      data-testid="frame-stats"
      // One serialised attribute rather than several formatted numbers the
      // benchmark would have to scrape back out of the DOM.
      data-stats={JSON.stringify(stats)}
      className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 sm:grid-cols-4"
    >
      <Stat
        testId="stat-longest-frame"
        label="Longest frame"
        value={`${stats.longestFrameMs.toFixed(1)} ms`}
      />
      <Stat testId="stat-p95-frame" label="p95 frame" value={`${stats.p95FrameMs.toFixed(1)} ms`} />
      <Stat
        testId="stat-dropped-frames"
        label="Dropped frames"
        value={`${String(stats.droppedFrames)} / ${String(stats.frames)}`}
      />
      <Stat testId="stat-fps" label="Effective FPS" value={stats.fps.toFixed(1)} />
    </dl>
  );
}

interface ResultPanelProps {
  result: CsvParseResult | null;
  elapsedMs: number | null;
}

function ResultPanel({ result, elapsedMs }: ResultPanelProps) {
  if (result === null) {
    return (
      <p data-testid="result-empty" className="text-sm text-[var(--color-muted-fg)]">
        No result yet.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Parse result">
      <p data-testid="result-summary" className="text-sm">
        <strong>{result.rowCount.toLocaleString()}</strong> rows,{" "}
        <strong>{result.errors.length + result.droppedErrorCount}</strong> rejected, net{" "}
        <strong>{formatMinor(result.totalMinor)}</strong>
        {elapsedMs === null ? null : ` · ${elapsedMs.toFixed(0)} ms`}
      </p>

      <table className="w-full max-w-2xl text-left text-sm">
        <caption className="sr-only">Totals by category</caption>
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th scope="col" className="py-1">
              Category
            </th>
            <th scope="col" className="py-1 text-right">
              Rows
            </th>
            <th scope="col" className="py-1 text-right">
              Total
            </th>
          </tr>
        </thead>
        <tbody data-testid="category-rows">
          {result.categories.map((category) => (
            <tr key={category.category} className="border-b border-[var(--color-border)]">
              <td className="py-1">{category.category}</td>
              <td className="py-1 text-right tabular-nums">{category.count.toLocaleString()}</td>
              <td className="py-1 text-right tabular-nums">{formatMinor(category.totalMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

interface StatProps {
  label: string;
  value: string;
  testId: string;
}

function Stat({ label, value, testId }: StatProps) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-[var(--color-muted-fg)]">{label}</dt>
      <dd data-testid={testId} className="text-lg font-semibold tabular-nums">
        {value}
      </dd>
    </div>
  );
}
