import { describe, it, expect } from "vitest";
import { paginationRange } from "@/shared/lib/paginationRange";

/**
 * The shape the assertions below are written in.
 *
 * Step 3 of the kata is where the return type had to stop being `number[]`,
 * and these two helpers are the whole decision: a gap is not a page, so it is
 * not a number pretending to be one. The alternative — a sentinel such as `-1`
 * or `"…"` in the array — makes every consumer re-derive which entries are
 * real, and makes a gap's *side* unavailable, which `Pagination.tsx` needs for
 * a stable React key.
 *
 * They are untyped literals on purpose: the test states the shape it wants and
 * the implementation is what has to agree with it, which is also what makes
 * this step's failure an assertion rather than a type error.
 */
const page = (n: number) => ({ type: "page", page: n });
const gap = (side: "start" | "end") => ({ type: "gap", side });

describe("paginationRange", () => {
  it("lists every page when they all fit", () => {
    expect(paginationRange({ page: 1, pageCount: 5 })).toEqual([
      page(1),
      page(2),
      page(3),
      page(4),
      page(5),
    ]);
  });

  /*
   * The requirement the loop from step 2 cannot meet, and the reason this
   * module exists at all: a control that renders one button per page is a
   * control that renders four hundred buttons.
   *
   * Seven slots, which is the default this fixes in place: the first page, the
   * last page, the current page, one sibling either side of it, and a gap
   * standing for each run that was left out. Nothing here says *why* seven —
   * that is step 5's business.
   */
  it("elides the middle of a long range", () => {
    expect(paginationRange({ page: 50, pageCount: 100 })).toEqual([
      page(1),
      gap("start"),
      page(49),
      page(50),
      page(51),
      gap("end"),
      page(100),
    ]);
  });
});
