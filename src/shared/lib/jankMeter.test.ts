import { describe, it, expect, vi } from "vitest";
import {
  createJankMeter,
  summarizeFrames,
  EMPTY_FRAME_STATS,
  FRAME_BUDGET_MS,
} from "@/shared/lib/jankMeter";

/**
 * Drives the meter with a scripted list of frame timestamps instead of real
 * frames, so the assertions are on arithmetic rather than on wall-clock luck.
 */
function scriptedScheduler(timestamps: readonly number[]) {
  let next = 0;
  const pending = new Map<number, (t: number) => void>();
  let handle = 0;

  return {
    requestFrame(callback: (timestamp: number) => void): number {
      handle += 1;
      pending.set(handle, callback);
      return handle;
    },
    cancelFrame(id: number): void {
      pending.delete(id);
    },
    /** Fires the queued callback with the next scripted timestamp. */
    advance(frames = 1): void {
      for (let i = 0; i < frames; i += 1) {
        const timestamp = timestamps[next];
        if (timestamp === undefined) return;
        const entry = [...pending.entries()][0];
        if (!entry) return;
        next += 1;
        const [id, callback] = entry;
        pending.delete(id);
        callback(timestamp);
      }
    },
    pendingCount(): number {
      return pending.size;
    },
  };
}

describe("summarizeFrames", () => {
  it("returns empty stats for fewer than two timestamps", () => {
    expect(summarizeFrames([])).toEqual(EMPTY_FRAME_STATS);
    expect(summarizeFrames([16])).toEqual(EMPTY_FRAME_STATS);
  });

  it("derives intervals from consecutive timestamps", () => {
    const stats = summarizeFrames([0, 16, 32, 48]);
    expect(stats.frames).toBe(3);
    expect(stats.durationMs).toBe(48);
    expect(stats.meanFrameMs).toBe(16);
  });

  it("reports the longest frame", () => {
    const stats = summarizeFrames([0, 16, 216, 232]);
    expect(stats.longestFrameMs).toBe(200);
  });

  it("counts frames over the budget as dropped", () => {
    // Intervals: 16, 100, 16, 250 → two over the 60Hz budget.
    const stats = summarizeFrames([0, 16, 116, 132, 382]);
    expect(stats.droppedFrames).toBe(2);
    expect(stats.droppedFrameRatio).toBeCloseTo(0.5, 5);
  });

  it("counts nothing as dropped when every frame is within budget", () => {
    const stats = summarizeFrames([0, 16, 32, 48]);
    expect(stats.droppedFrames).toBe(0);
    expect(stats.droppedFrameRatio).toBe(0);
  });

  it("honours a custom frame budget", () => {
    const timestamps = [0, 10, 20, 30];
    expect(summarizeFrames(timestamps, 8).droppedFrames).toBe(3);
    expect(summarizeFrames(timestamps, 12).droppedFrames).toBe(0);
  });

  it("uses the exact frame budget as an inclusive upper bound", () => {
    // An interval equal to the budget is a frame that made it, not a drop.
    expect(summarizeFrames([0, FRAME_BUDGET_MS]).droppedFrames).toBe(0);
  });

  /** Builds timestamps whose consecutive gaps are exactly `intervals`. */
  function timestampsFrom(intervals: readonly number[]): number[] {
    const timestamps = [0];
    for (const interval of intervals) timestamps.push((timestamps.at(-1) ?? 0) + interval);
    return timestamps;
  }

  it("computes a nearest-rank p95 that reflects a bad tail", () => {
    // 20 intervals, two of them stalls: nearest rank puts p95 at the 19th
    // smallest, so the tail shows up in the number.
    const intervals = [...Array<number>(18).fill(10), 500, 500];
    const stats = summarizeFrames(timestampsFrom(intervals));
    expect(stats.frames).toBe(20);
    expect(stats.p95FrameMs).toBe(500);
    expect(stats.longestFrameMs).toBe(500);
  });

  it("keeps a lone outlier out of p95 but not out of the longest frame", () => {
    // One stall in 20 frames is under 5% of the sample, so p95 stays clean —
    // which is why the longest frame is reported alongside it.
    const intervals = [...Array<number>(19).fill(10), 500];
    const stats = summarizeFrames(timestampsFrom(intervals));
    expect(stats.p95FrameMs).toBe(10);
    expect(stats.longestFrameMs).toBe(500);
  });

  it("resolves p95 to a real sample for a two-frame recording", () => {
    expect(summarizeFrames([0, 16, 40]).p95FrameMs).toBe(24);
  });

  it("computes effective fps from the sampled span", () => {
    // 10 intervals of 100ms → 1 second of recording at 10fps.
    const timestamps = Array.from({ length: 11 }, (_, i) => i * 100);
    expect(summarizeFrames(timestamps).fps).toBeCloseTo(10, 5);
  });

  it("reports zero fps when no time elapsed between frames", () => {
    const stats = summarizeFrames([5, 5, 5]);
    expect(stats.durationMs).toBe(0);
    expect(stats.fps).toBe(0);
  });
});

describe("createJankMeter", () => {
  it("is idle before start", () => {
    const meter = createJankMeter({ requestFrame: () => 1, cancelFrame: () => {} });
    expect(meter.isRecording()).toBe(false);
  });

  it("records the frames it observes between start and stop", () => {
    const scheduler = scriptedScheduler([0, 16, 33, 250]);
    const meter = createJankMeter(scheduler);

    meter.start();
    expect(meter.isRecording()).toBe(true);
    scheduler.advance(4);

    const stats = meter.stop();
    expect(stats.frames).toBe(3);
    expect(stats.longestFrameMs).toBe(217);
    expect(stats.droppedFrames).toBe(2);
    expect(meter.isRecording()).toBe(false);
  });

  it("ignores a second start while already recording", () => {
    const scheduler = scriptedScheduler([0, 16, 32]);
    const requestFrame = vi.fn(scheduler.requestFrame);
    const meter = createJankMeter({ requestFrame, cancelFrame: scheduler.cancelFrame });

    meter.start();
    scheduler.advance(1);
    meter.start();

    // One request to open the loop, one queued by the frame that fired — the
    // duplicate start must not open a second loop.
    expect(requestFrame).toHaveBeenCalledTimes(2);
  });

  it("cancels the pending frame request on stop", () => {
    const scheduler = scriptedScheduler([0, 16, 32]);
    const meter = createJankMeter(scheduler);

    meter.start();
    scheduler.advance(2);
    expect(scheduler.pendingCount()).toBe(1);

    meter.stop();
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("stops cleanly when it was never started", () => {
    const meter = createJankMeter({ requestFrame: () => 1, cancelFrame: () => {} });
    expect(meter.stop()).toEqual(EMPTY_FRAME_STATS);
  });

  it("discards the previous recording when restarted", () => {
    const scheduler = scriptedScheduler([0, 16, 500, 516, 532]);
    const meter = createJankMeter(scheduler);

    meter.start();
    scheduler.advance(3);
    expect(meter.stop().longestFrameMs).toBe(484);

    meter.start();
    scheduler.advance(2);
    const second = meter.stop();
    expect(second.frames).toBe(1);
    expect(second.longestFrameMs).toBe(16);
  });

  it("applies a custom frame budget to the recorded frames", () => {
    const scheduler = scriptedScheduler([0, 10, 20]);
    const meter = createJankMeter({
      requestFrame: scheduler.requestFrame,
      cancelFrame: scheduler.cancelFrame,
      frameBudgetMs: 8,
    });

    meter.start();
    scheduler.advance(3);
    expect(meter.stop().droppedFrames).toBe(2);
  });

  it("falls back to the browser scheduler when none is injected", () => {
    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 42);
    const caf = vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});

    const meter = createJankMeter();
    meter.start();
    expect(raf).toHaveBeenCalledTimes(1);

    meter.stop();
    expect(caf).toHaveBeenCalledWith(42);

    raf.mockRestore();
    caf.mockRestore();
  });
});
