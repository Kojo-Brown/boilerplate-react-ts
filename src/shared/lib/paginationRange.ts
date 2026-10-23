/**
 * Which page numbers a pagination control should show.
 *
 * The arithmetic lives here, away from the component, because "which pages"
 * is a pure function of two numbers and every interesting thing about it is
 * assertable without rendering anything. `Pagination.tsx` decides what a page
 * number looks like and what happens when one is pressed; this module decides
 * which ones there are.
 *
 * It is also the subject of the kata in `docs/tdd.md`: the four properties
 * below were not designed and then implemented, they were implemented one
 * failing test at a time, and two of them are properties nobody writes down
 * in advance. The commit history on the pull request is the artefact.
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
 * The width of the control, in entries, and it is a width rather than a
 * maximum: every branch below returns exactly this many once there is
 * anything to elide.
 *
 * Seven is the smallest number that fits the five things the control has to
 * say at once — first page, last page, current page, a sibling either side of
 * it, and a gap for each run left out — and a `pageCount` at or under it needs
 * no gaps, because every page fits.
 */
const MAX_ITEMS = 7;

/**
 * How many pages an edge block runs for.
 *
 * `MAX_ITEMS` minus the two entries an edge block does not spend on a run: the
 * single gap, and the far end of the range behind it.
 */
const EDGE_BLOCK = MAX_ITEMS - 2;

function pageItem(page: number): PaginationItem {
  return { type: "page", page };
}

function gapItem(side: "start" | "end"): PaginationItem {
  return { type: "gap", side };
}

/** The pages from `start` to `end` inclusive, or nothing if that is empty. */
function pagesFrom(start: number, end: number): PaginationItem[] {
  const pages: PaginationItem[] = [];
  for (let n = start; n <= end; n++) pages.push(pageItem(n));
  return pages;
}

export function paginationRange({ page, pageCount }: PaginationRangeOptions): PaginationItem[] {
  if (pageCount <= MAX_ITEMS) return pagesFrom(1, pageCount);

  const firstSibling = Math.max(page - 1, 1);
  const lastSibling = Math.min(page + 1, pageCount);

  /*
   * A gap is worth a slot only once it stands for two pages or more.
   *
   * Pages 2 to `firstSibling - 1` are what a leading gap elides, so it elides
   * two or more only once `firstSibling` reaches 4; the trailing gap elides
   * `lastSibling + 1` to `pageCount - 1`, so it needs `lastSibling` to stop
   * three short of the end. Below those thresholds the edge block takes the
   * slot and puts the page itself in it — which it has room for, because the
   * block is the same five pages either way.
   */
  const needsStartGap = firstSibling > 3;
  const needsEndGap = lastSibling < pageCount - 2;

  /*
   * Three cases rather than four conditional pushes, and the reason is the
   * width. Asking at each boundary whether there is anything to elide answers
   * each question correctly and still gets the total wrong, because a gap that
   * turns out to be unnecessary leaves a slot nothing claims. Each case here
   * spends all seven.
   *
   * There is no fourth case. Needing neither gap means the current page is
   * within four of the start and within three of the end at once, which
   * requires `pageCount` to be no larger than MAX_ITEMS, and that returned
   * above.
   */
  if (!needsStartGap) {
    return [...pagesFrom(1, EDGE_BLOCK), gapItem("end"), pageItem(pageCount)];
  }

  if (!needsEndGap) {
    return [pageItem(1), gapItem("start"), ...pagesFrom(pageCount - EDGE_BLOCK + 1, pageCount)];
  }

  return [
    pageItem(1),
    gapItem("start"),
    ...pagesFrom(firstSibling, lastSibling),
    gapItem("end"),
    pageItem(pageCount),
  ];
}
