import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/shared/ui/Button";
import {
  ConcurrentFilterList,
  type SchedulingMode,
} from "@/shared/ui/performance/ConcurrentFilterList";
import { createFilterableItems } from "@/shared/lib/filterableItems";
import { createJankMeter, type FrameStats, type JankMeter } from "@/shared/lib/jankMeter";
import { parseItemCount, parseMode } from "@/pages/concurrency-lab/concurrencyLabParams";

/**
 * Harness for the `useTransition` + `useDeferredValue` pattern.
 *
 * Mode and dataset size live in the URL (`?mode=blocking&n=15000`) so a run is
 * shareable and so the Playwright benchmark can drive both arms of the
 * comparison without any test-only hooks in the component.
 */
export function ConcurrencyLabPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = parseMode(searchParams.get("mode"));
  const itemCount = parseItemCount(searchParams.get("n"));

  const items = useMemo(() => createFilterableItems(itemCount), [itemCount]);

  const meterRef = useRef<JankMeter | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [stats, setStats] = useState<FrameStats | null>(null);

  const setMode = (next: SchedulingMode): void => {
    const params = new URLSearchParams(searchParams);
    params.set("mode", next);
    setSearchParams(params, { replace: true });
    // Numbers from one scheduler say nothing about the other.
    setStats(null);
  };

  const toggleRecording = (): void => {
    const meter = (meterRef.current ??= createJankMeter());
    if (meter.isRecording()) {
      setStats(meter.stop());
      setIsRecording(false);
      return;
    }
    setStats(null);
    meter.start();
    setIsRecording(true);
  };

  return (
    <main className="flex flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Concurrency Lab</h1>
        <p className="max-w-2xl text-[var(--color-muted-fg)]">
          {itemCount.toLocaleString()} rows, rendered without virtualisation so a full re-render
          costs more than one frame. Type into the filter and watch the frame stats: both modes do
          the same work, but only one of them does it without blocking the keystroke.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2" role="group" aria-label="Scheduling mode">
          <ModeButton current={mode} value="concurrent" onSelect={setMode}>
            Concurrent
          </ModeButton>
          <ModeButton current={mode} value="blocking" onSelect={setMode}>
            Blocking
          </ModeButton>
        </div>

        <Button
          variant={isRecording ? "secondary" : "primary"}
          onClick={toggleRecording}
          data-testid="record-toggle"
        >
          {isRecording ? "Stop recording" : "Record frames"}
        </Button>

        <span data-testid="recording-state" className="text-sm text-[var(--color-muted-fg)]">
          {isRecording ? "Recording…" : "Idle"}
        </span>
      </div>

      <FrameStatsPanel stats={stats} />

      <ConcurrentFilterList items={items} mode={mode} />
    </main>
  );
}

interface ModeButtonProps {
  current: SchedulingMode;
  value: SchedulingMode;
  onSelect: (mode: SchedulingMode) => void;
  children: React.ReactNode;
}

function ModeButton({ current, value, onSelect, children }: ModeButtonProps) {
  return (
    <Button
      variant={current === value ? "primary" : "ghost"}
      aria-pressed={current === value}
      onClick={() => {
        onSelect(value);
      }}
    >
      {children}
    </Button>
  );
}

interface FrameStatsPanelProps {
  stats: FrameStats | null;
}

function FrameStatsPanel({ stats }: FrameStatsPanelProps) {
  if (!stats) {
    return (
      <p data-testid="frame-stats-empty" className="text-sm text-[var(--color-muted-fg)]">
        No recording yet — press <strong>Record frames</strong>, type in the filter, then stop.
      </p>
    );
  }

  return (
    <dl
      data-testid="frame-stats"
      // The serialised copy is what the benchmark reads: one attribute instead
      // of scraping several formatted numbers back out of the DOM.
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
        value={`${stats.droppedFrames} / ${stats.frames}`}
      />
      <Stat testId="stat-fps" label="Effective FPS" value={stats.fps.toFixed(1)} />
    </dl>
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
