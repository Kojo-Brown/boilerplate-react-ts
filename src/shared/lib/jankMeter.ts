/**
 * Frame-timing recorder used to quantify jank (long frames) during an
 * interaction. Sampling is driven by `requestAnimationFrame`: the browser only
 * fires it once a frame has actually been produced, so the gap between two
 * callbacks is the time the main thread took to turn a frame around. A gap
 * meaningfully above the display's frame budget means the user saw a stutter.
 *
 * The scheduler is injectable so tests can drive the meter with a scripted
 * sequence of timestamps instead of waiting on real frames.
 */

/** 60Hz frame budget, in milliseconds. */
export const FRAME_BUDGET_MS = 1000 / 60;

export interface FrameStats {
  /** Number of frame intervals sampled (one fewer than timestamps seen). */
  frames: number;
  /** Wall-clock span covered by the recording, in ms. */
  durationMs: number;
  /** Slowest single frame interval, in ms — the worst stutter the user saw. */
  longestFrameMs: number;
  /** Mean frame interval, in ms. */
  meanFrameMs: number;
  /** 95th-percentile frame interval, in ms (nearest-rank). */
  p95FrameMs: number;
  /** Intervals longer than the frame budget — i.e. frames the user lost. */
  droppedFrames: number;
  /** Share of intervals over budget, 0–1. */
  droppedFrameRatio: number;
  /** Effective frames per second across the recording. */
  fps: number;
}

export interface JankMeterOptions {
  /**
   * Interval above which a frame counts as dropped, in ms. Defaults to the
   * 60Hz budget; raise it on a high-refresh display only if the expectations
   * you compare against move with it.
   */
  frameBudgetMs?: number | undefined;
  requestFrame?: ((callback: (timestamp: number) => void) => number) | undefined;
  cancelFrame?: ((handle: number) => void) | undefined;
}

export interface JankMeter {
  /** Begins sampling. Calling it again while running is a no-op. */
  start: () => void;
  /** Stops sampling and returns the stats for the completed recording. */
  stop: () => FrameStats;
  /** True between `start()` and `stop()`. */
  isRecording: () => boolean;
}

export const EMPTY_FRAME_STATS: FrameStats = {
  frames: 0,
  durationMs: 0,
  longestFrameMs: 0,
  meanFrameMs: 0,
  p95FrameMs: 0,
  droppedFrames: 0,
  droppedFrameRatio: 0,
  fps: 0,
};

/**
 * Computes frame statistics from raw frame timestamps (in ms, monotonic).
 * Exported separately so the maths can be exercised without a scheduler.
 */
export function summarizeFrames(
  timestamps: readonly number[],
  frameBudgetMs: number = FRAME_BUDGET_MS,
): FrameStats {
  // n timestamps describe n-1 intervals; a single frame says nothing about how
  // long anything took.
  if (timestamps.length < 2) return EMPTY_FRAME_STATS;

  const intervals: number[] = [];
  let previous: number | undefined;
  for (const timestamp of timestamps) {
    if (previous !== undefined) intervals.push(timestamp - previous);
    previous = timestamp;
  }

  const durationMs = intervals.reduce((sum, ms) => sum + ms, 0);
  const sorted = [...intervals].sort((a, b) => a - b);
  // Nearest-rank percentile, clamped so a short recording still resolves to a
  // real sample rather than running off the end of the array.
  const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  const droppedFrames = intervals.filter((ms) => ms > frameBudgetMs).length;

  return {
    frames: intervals.length,
    durationMs,
    longestFrameMs: sorted.at(-1) ?? 0,
    meanFrameMs: durationMs / intervals.length,
    p95FrameMs: sorted[p95Index] ?? 0,
    droppedFrames,
    droppedFrameRatio: droppedFrames / intervals.length,
    fps: durationMs > 0 ? (intervals.length / durationMs) * 1000 : 0,
  };
}

/**
 * Creates a frame-timing recorder.
 *
 * Usage:
 *   const meter = createJankMeter();
 *   meter.start();
 *   // ...drive the interaction under test...
 *   const stats = meter.stop();
 *   console.log(stats.longestFrameMs, stats.droppedFrames);
 */
export function createJankMeter(options: JankMeterOptions = {}): JankMeter {
  const frameBudgetMs = options.frameBudgetMs ?? FRAME_BUDGET_MS;
  const requestFrame =
    options.requestFrame ??
    ((callback: (timestamp: number) => void) => requestAnimationFrame(callback));
  const cancelFrame =
    options.cancelFrame ??
    ((handle: number) => {
      cancelAnimationFrame(handle);
    });

  let timestamps: number[] = [];
  let handle: number | null = null;

  const tick = (timestamp: number): void => {
    timestamps.push(timestamp);
    handle = requestFrame(tick);
  };

  return {
    start() {
      if (handle !== null) return;
      timestamps = [];
      handle = requestFrame(tick);
    },
    stop() {
      if (handle !== null) {
        cancelFrame(handle);
        handle = null;
      }
      return summarizeFrames(timestamps, frameBudgetMs);
    },
    isRecording() {
      return handle !== null;
    },
  };
}
