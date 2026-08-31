/**
 * A stand-in for `@tanstack/react-virtual` in jsdom.
 *
 * Used as `vi.mock("@tanstack/react-virtual", () => import("@/test/virtualizerMock"))`.
 *
 * This is not a convenience. The real virtualizer measures elements and
 * subscribes with a `ResizeObserver`, and jsdom implements neither: every
 * `getBoundingClientRect()` is a box of zeros and `ResizeObserver` is not
 * defined at all, so the real hook throws on construction. Nothing about
 * windowing can be observed in this environment, which is why the claims that
 * are *about* windowing — that the DOM row count stays flat while the dataset
 * grows, that the scroll range is the full dataset — are asserted in
 * `e2e/windowed-infinite-scroll.spec.ts` against a real browser instead.
 *
 * What a unit test can still see, and what this mock preserves faithfully, is
 * everything that is not geometry: which items the component chose to render,
 * what key it gave them, and when it asked for the next page.
 */

interface MockVirtualizerOptions {
  count: number;
  estimateSize: (index: number) => number;
  getScrollElement: () => Element | null;
  overscan?: number | undefined;
  getItemKey?: ((index: number) => string | number) | undefined;
}

export interface MockVirtualItem {
  key: string | number;
  index: number;
  start: number;
  end: number;
  size: number;
}

interface MockVirtualizer {
  getVirtualItems: () => MockVirtualItem[];
  getTotalSize: () => number;
  measureElement: (node: Element | null) => void;
}

/** How many rows the fake window shows, and where it starts. */
let windowStart = 0;
let windowSize = 10;
let windowOverrun = 0;

export interface VirtualWindow {
  start?: number;
  size?: number;
  /**
   * Rows to report *past* the end of the dataset.
   *
   * The real virtualizer does this transiently: a shrink is applied to `count`
   * one render before the range is recomputed, so for that render it names
   * indices no longer backed by an item. Consumers have to survive it, and
   * this is the only way to reproduce it here.
   */
  overrun?: number;
}

/** Move the fake window. Call inside a test, before the render it affects. */
export function setVirtualWindow({ start, size, overrun }: VirtualWindow): void {
  if (start !== undefined) windowStart = start;
  if (size !== undefined) windowSize = size;
  if (overrun !== undefined) windowOverrun = overrun;
}

/** Restore the default window (rows 0–9, no overrun). Call in `afterEach`. */
export function resetVirtualWindow(): void {
  windowStart = 0;
  windowSize = 10;
  windowOverrun = 0;
}

export function useVirtualizer(options: MockVirtualizerOptions): MockVirtualizer {
  const { count, estimateSize, getItemKey } = options;
  // Read so a component that forgets to supply one fails here rather than
  // silently virtualizing against nothing.
  options.getScrollElement();
  const rowHeight = estimateSize(0);

  return {
    getVirtualItems: () => {
      const first = Math.min(windowStart, count);
      const last = Math.min(first + windowSize, count) + windowOverrun;
      const rows: MockVirtualItem[] = [];
      for (let index = first; index < last; index += 1) {
        rows.push({
          key: getItemKey ? getItemKey(index) : index,
          index,
          start: index * rowHeight,
          end: (index + 1) * rowHeight,
          size: rowHeight,
        });
      }
      return rows;
    },
    getTotalSize: () => count * rowHeight,
    measureElement: () => {},
  };
}
