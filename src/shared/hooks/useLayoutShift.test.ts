import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useLayoutShift } from "@/shared/hooks/useLayoutShift";

/**
 * jsdom implements no `PerformanceObserver` at all, so the hook's two guards
 * are reachable only by supplying one. The stub is deliberately faithful about
 * the one behaviour that shapes the hook: `observe` on an unknown entry type
 * throws rather than returning an observer that stays quiet.
 */
class StubPerformanceObserver {
  static supportedEntryTypes: string[] = ["layout-shift"];
  static instances: StubPerformanceObserver[] = [];

  disconnected = false;
  buffered = false;

  constructor(private readonly callback: PerformanceObserverCallback) {
    StubPerformanceObserver.instances.push(this);
  }

  observe(options: { type: string; buffered?: boolean }): void {
    if (!StubPerformanceObserver.supportedEntryTypes.includes(options.type)) {
      throw new TypeError(`Unsupported entry type: ${options.type}`);
    }
    this.buffered = options.buffered === true;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  emit(entries: { value: number; startTime: number; hadRecentInput: boolean }[]): void {
    this.callback(
      {
        getEntries: () => entries as unknown as PerformanceEntryList,
      } as PerformanceObserverEntryList,
      this as unknown as PerformanceObserver,
    );
  }
}

function latest(): StubPerformanceObserver {
  return StubPerformanceObserver.instances.at(-1)!;
}

beforeEach(() => {
  StubPerformanceObserver.instances = [];
  StubPerformanceObserver.supportedEntryTypes = ["layout-shift"];
  vi.stubGlobal("PerformanceObserver", StubPerformanceObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useLayoutShift", () => {
  it("reports zero before anything shifts", () => {
    const { result } = renderHook(() => useLayoutShift("run-1"));
    expect(result.current).toEqual({ cls: 0, total: 0, excluded: 0, supported: true });
  });

  it("subscribes with buffered entries so shifts before mount still count", () => {
    // The observer is created after the images that moved the page have
    // already loaded. Without `buffered` the first run of the meter would
    // always read zero.
    renderHook(() => useLayoutShift("run-1"));
    expect(latest().buffered).toBe(true);
  });

  it("accumulates observed shifts", () => {
    const { result } = renderHook(() => useLayoutShift("run-1"));
    act(() => {
      latest().emit([{ value: 0.08, startTime: 1_500, hadRecentInput: false }]);
    });
    expect(result.current.cls).toBeCloseTo(0.08);
    expect(result.current.total).toBeCloseTo(0.08);
  });

  it("separates the shifts the user caused from the ones it scores", () => {
    const { result } = renderHook(() => useLayoutShift("run-1"));
    act(() => {
      latest().emit([
        { value: 0.4, startTime: 1_500, hadRecentInput: true },
        { value: 0.05, startTime: 3_000, hadRecentInput: false },
      ]);
    });
    expect(result.current.cls).toBeCloseTo(0.05);
    expect(result.current.excluded).toBeCloseTo(0.4);
  });

  it("drops the previous run's history when the run key changes", () => {
    // `buffered: true` replays everything the browser has recorded, so a
    // restart that only cleared the list would immediately be handed the first
    // run's shifts again.
    const { result, rerender } = renderHook(({ key }) => useLayoutShift(key), {
      initialProps: { key: "run-1" },
    });
    act(() => {
      latest().emit([{ value: 0.2, startTime: 1_000, hadRecentInput: false }]);
    });
    expect(result.current.cls).toBeCloseTo(0.2);

    rerender({ key: "run-2" });
    expect(result.current.cls).toBe(0);

    act(() => {
      // Replayed history from before the restart, and a genuinely new shift.
      latest().emit([
        { value: 0.2, startTime: 1_000, hadRecentInput: false },
        { value: 0.03, startTime: 6_000, hadRecentInput: false },
      ]);
    });
    expect(result.current.cls).toBeCloseTo(0.03);
  });

  it("keeps one observer across restarts", () => {
    const { rerender } = renderHook(({ key }) => useLayoutShift(key), {
      initialProps: { key: "run-1" },
    });
    rerender({ key: "run-2" });
    expect(StubPerformanceObserver.instances).toHaveLength(1);
    expect(latest().disconnected).toBe(false);
  });

  it("disconnects on unmount", () => {
    const { unmount } = renderHook(() => useLayoutShift("run-1"));
    unmount();
    expect(latest().disconnected).toBe(true);
  });

  it("reports unsupported rather than throwing where layout-shift is unknown", () => {
    // Firefox and WebKit. Constructing the observer would throw, so the check
    // has to come first.
    StubPerformanceObserver.supportedEntryTypes = ["paint"];
    const { result } = renderHook(() => useLayoutShift("run-1"));
    expect(result.current).toEqual({ cls: 0, total: 0, excluded: 0, supported: false });
    expect(StubPerformanceObserver.instances).toHaveLength(0);
  });

  it("reports unsupported where there is no PerformanceObserver at all", () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    const { result } = renderHook(() => useLayoutShift("run-1"));
    expect(result.current.supported).toBe(false);
  });
});
