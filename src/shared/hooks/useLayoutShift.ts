import { useEffect, useState } from "react";
import { accumulateShifts, type LayoutShiftLike, type ShiftTotals } from "@/shared/lib/layoutShift";

export interface LayoutShiftReading extends ShiftTotals {
  /** Whether this engine reports `layout-shift` entries at all. */
  readonly supported: boolean;
}

const UNSUPPORTED: LayoutShiftReading = { cls: 0, total: 0, excluded: 0, supported: false };

/** One measurement: which run it belongs to, when it started, what it saw. */
interface Run {
  readonly key: unknown;
  readonly baseline: number;
  readonly entries: readonly LayoutShiftLike[];
}

function latestStartTime(run: Run): number {
  return run.entries.reduce((latest, entry) => Math.max(latest, entry.startTime), run.baseline);
}

/**
 * `layout-shift` is Chromium-only, and asking for an entry type an engine does
 * not know **throws** rather than yielding an observer that never fires. The
 * capability check therefore has to happen before construction, and the
 * construction still needs a `try` — `supportedEntryTypes` is itself absent in
 * older engines.
 */
function canObserveLayoutShift(): boolean {
  if (typeof PerformanceObserver === "undefined") return false;
  return PerformanceObserver.supportedEntryTypes.includes("layout-shift");
}

function isLayoutShift(entry: PerformanceEntry): entry is PerformanceEntry & LayoutShiftLike {
  // `LayoutShift` is not in `lib.dom`: the Layout Instability spec is a draft
  // and TypeScript ships no interface for it. Reading the two fields through a
  // guard is the alternative to an assertion that would be wrong the moment
  // another entry type arrives on this observer.
  const value: unknown = Reflect.get(entry, "value");
  const hadRecentInput: unknown = Reflect.get(entry, "hadRecentInput");
  return typeof value === "number" && typeof hadRecentInput === "boolean";
}

/**
 * Live CLS for the current document, restartable.
 *
 * Changing `runKey` starts a fresh measurement: the entries already seen are
 * dropped and a baseline is taken, so anything counted before the restart is
 * ignored. The baseline is the reason a restart is more than clearing a list —
 * the observer is created with `buffered: true`, which replays every shift the
 * browser has recorded, so a bare re-subscribe hands the second run the first
 * run's history.
 *
 * The observer itself is created once per mount and never torn down between
 * runs, so a shift that lands during the restart is still counted.
 */
export function useLayoutShift(runKey: unknown): LayoutShiftReading {
  const [supported] = useState(canObserveLayoutShift);
  const [run, setRun] = useState<Run>(() => ({
    key: runKey,
    baseline: Number.NEGATIVE_INFINITY,
    entries: [],
  }));

  // Adjusting state during render, rather than in an effect. React documents
  // this as the way to reset state when a prop changes: the component
  // re-renders immediately with the new value and nothing downstream ever sees
  // the stale one. The effect version renders the old run's total once before
  // clearing it, which on a page whose subject is visual stability is a flash
  // of the wrong number.
  if (run.key !== runKey) {
    // The baseline is the latest shift already counted, not a clock reading.
    // `performance.now()` is impure and refusing it in render is correct — but
    // it is also the wrong question. What has to be excluded from the next run
    // is what this one already reported, and the entries know that exactly,
    // where a timestamp only approximates it.
    setRun({ key: runKey, baseline: latestStartTime(run), entries: [] });
  }

  useEffect(() => {
    if (!supported) return;
    const observer = new PerformanceObserver((list) => {
      const observed = list.getEntries().filter(isLayoutShift);
      if (observed.length === 0) return;
      setRun((previous) => ({
        ...previous,
        entries: [
          ...previous.entries,
          // Filtered against the *current* baseline, read from the updater
          // rather than closed over — the callback outlives every restart.
          ...observed
            .filter((entry) => entry.startTime > previous.baseline)
            .map<LayoutShiftLike>((entry) => ({
              value: entry.value,
              startTime: entry.startTime,
              hadRecentInput: entry.hadRecentInput,
            })),
        ],
      }));
    });
    observer.observe({ type: "layout-shift", buffered: true });
    return () => {
      observer.disconnect();
    };
  }, [supported]);

  if (!supported) return UNSUPPORTED;
  return { ...accumulateShifts(run.entries), supported: true };
}
