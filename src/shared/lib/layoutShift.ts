/**
 * Cumulative Layout Shift, computed the way the metric is actually defined.
 *
 * Two details separate this from the sum that everyone writes first, and both
 * change the number by a lot:
 *
 * **Shifts within 500ms of a user interaction do not count.** The browser sets
 * `hadRecentInput` on them, and CLS ignores them: opening an accordion moves
 * the page, and the user asked for that. It also means a demonstration that
 * reflows *on a button click* reads zero however violently it jumps — which is
 * not the metric being wrong, it is the metric working, and it is why the
 * image fixture behind `/labs/images` answers slowly enough for its shift to
 * land outside the window.
 *
 * **CLS is the worst session window, not the total.** Shifts are grouped into
 * windows that end after a 1s gap or 5s of elapsed time, and the score is the
 * largest window's sum. A plain total would make a long-lived page score worse
 * than a short one for the same experience, which would reward navigating away
 * — the windowing is what makes the number comparable at all.
 */

/** The fields of a `layout-shift` entry this reads. */
export interface LayoutShiftLike {
  readonly value: number;
  readonly startTime: number;
  readonly hadRecentInput: boolean;
}

export interface ShiftTotals {
  /** The metric: the largest session window, input-triggered shifts excluded. */
  readonly cls: number;
  /** Every shift observed, including the ones CLS discards. */
  readonly total: number;
  /**
   * The part of `total` that CLS discarded as user-initiated.
   *
   * Reported rather than dropped so a zero score is legible: "nothing moved"
   * and "everything moved right after you clicked" are very different pages
   * and the score alone cannot tell them apart.
   */
  readonly excluded: number;
}

/** A session window ends after this long without a shift. */
const SESSION_GAP_MS = 1_000;
/** A session window is at most this long, however continuous the shifting. */
const SESSION_MAX_MS = 5_000;

export function accumulateShifts(entries: Iterable<LayoutShiftLike>): ShiftTotals {
  let cls = 0;
  let total = 0;
  let excluded = 0;

  let windowValue = 0;
  let windowStart = 0;
  let windowLast = 0;
  let windowOpen = false;

  for (const entry of entries) {
    total += entry.value;
    if (entry.hadRecentInput) {
      excluded += entry.value;
      continue;
    }

    const startsNewWindow =
      !windowOpen ||
      entry.startTime - windowLast > SESSION_GAP_MS ||
      entry.startTime - windowStart > SESSION_MAX_MS;

    if (startsNewWindow) {
      windowValue = entry.value;
      windowStart = entry.startTime;
      windowOpen = true;
    } else {
      windowValue += entry.value;
    }
    windowLast = entry.startTime;
    cls = Math.max(cls, windowValue);
  }

  return { cls, total, excluded };
}

/** The thresholds Core Web Vitals grades CLS against. */
export function rateCls(cls: number): "good" | "needs-improvement" | "poor" {
  if (cls <= 0.1) return "good";
  if (cls <= 0.25) return "needs-improvement";
  return "poor";
}
