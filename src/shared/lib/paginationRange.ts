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
  const items: PaginationItem[] = [];

  if (firstSibling > 1) {
    items.push({ type: "page", page: 1 });
    if (firstSibling > 2) items.push({ type: "gap", side: "start" });
  }

  for (let n = firstSibling; n <= lastSibling; n++) items.push({ type: "page", page: n });

  if (lastSibling < pageCount) {
    if (lastSibling < pageCount - 1) items.push({ type: "gap", side: "end" });
    items.push({ type: "page", page: pageCount });
  }

  return items;
}
