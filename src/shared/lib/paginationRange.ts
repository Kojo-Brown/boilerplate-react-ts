/**
 * Which page numbers a pagination control should show.
 *
 * The arithmetic lives here, away from the component, because "which pages"
 * is a pure function of three numbers and every interesting thing about it is
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
 * Every page, in order.
 *
 * Knowingly incomplete: this is the green of step 2 and it is the whole
 * implementation the one failing test asks for. A list of 400 pages renders
 * 400 buttons here, which is the defect step 3 writes a test for rather than
 * the defect step 2 guesses at.
 */
export function paginationRange({ pageCount }: PaginationRangeOptions): number[] {
  const pages: number[] = [];
  for (let n = 1; n <= pageCount; n++) pages.push(n);
  return pages;
}
