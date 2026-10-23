/**
 * Which page numbers a pagination control should show.
 *
 * The arithmetic lives here, away from the component, because "which pages"
 * is a pure function of two numbers and every interesting thing about it is
 * assertable without rendering anything. `Pagination.tsx` decides what a page
 * number looks like and what happens when one is pressed; this module decides
 * which ones there are.
 */

/** What to show, for whom. */
export interface PaginationRangeOptions {
  /** The page currently being displayed, 1-based. */
  readonly page: number;
  /** How many pages there are in total. */
  readonly pageCount: number;
}

/**
 * One entry in the control.
 *
 * A gap carries the side it sits on rather than an index, because that is
 * what a React key needs to be stable across: the run of pages a gap stands
 * for changes on every navigation, the fact that it is the leading gap does
 * not.
 */
export type PaginationItem =
  | { readonly type: "page"; readonly page: number }
  | { readonly type: "gap"; readonly side: "start" | "end" };

/**
 * The widest the control is allowed to be.
 *
 * Seven entries: the first page, a gap, the current page with one sibling
 * either side, a gap, and the last page. Anything shorter than this fits
 * without eliding anything.
 */
const MAX_ITEMS = 7;

export function paginationRange({ page, pageCount }: PaginationRangeOptions): PaginationItem[] {
  if (pageCount <= MAX_ITEMS) {
    const all: PaginationItem[] = [];
    for (let n = 1; n <= pageCount; n++) all.push({ type: "page", page: n });
    return all;
  }

  const firstSibling = Math.max(page - 1, 1);
  const lastSibling = Math.min(page + 1, pageCount);
  const needsStartGap = firstSibling > 2;
  const needsEndGap = lastSibling < pageCount - 1;

  /*
   * Three cases rather than four conditional pushes, and the reason is the
   * width. Asking at each boundary whether there is anything to elide answers
   * each question correctly and still gets the total wrong, because a gap that
   * is not needed leaves a slot nothing claims. Here each case spends every
   * slot it has: the two edge blocks are MAX_ITEMS - 2 pages long — the run,
   * one gap, and the far end — and the middle case is a first page, a gap,
   * three pages, a gap and a last page.
   *
   * There is no fourth case. Needing neither gap means the window reaches
   * within one page of both ends at once, which requires `pageCount` to be no
   * larger than MAX_ITEMS, and that returned above.
   */
  const edgeBlock = MAX_ITEMS - 2;

  if (!needsStartGap) {
    const items: PaginationItem[] = [];
    for (let n = 1; n <= edgeBlock; n++) items.push({ type: "page", page: n });
    items.push({ type: "gap", side: "end" }, { type: "page", page: pageCount });
    return items;
  }

  if (!needsEndGap) {
    const items: PaginationItem[] = [
      { type: "page", page: 1 },
      { type: "gap", side: "start" },
    ];
    for (let n = pageCount - edgeBlock + 1; n <= pageCount; n++) {
      items.push({ type: "page", page: n });
    }
    return items;
  }

  const items: PaginationItem[] = [
    { type: "page", page: 1 },
    { type: "gap", side: "start" },
  ];
  for (let n = firstSibling; n <= lastSibling; n++) items.push({ type: "page", page: n });
  items.push({ type: "gap", side: "end" }, { type: "page", page: pageCount });
  return items;
}
