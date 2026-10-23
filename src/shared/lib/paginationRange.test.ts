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
  /*
   * The property, rather than three more examples of it.
   *
   * A control whose entry count depends on which page you are on is a control
   * that changes size as you use it: the buttons move under the pointer, and
   * every click lands on a layout one pixel-reflow away from the one that was
   * clicked. It is the defect a worked example hides, because any single
   * expectation is self-consistent — you have to compare two pages to see it,
   * and the honest way to compare two is to compare all of them.
   */
  it("keeps the same number of entries whichever page is current", () => {
    const widths = new Set<number>();
    for (let current = 1; current <= 100; current++) {
      widths.add(paginationRange({ page: current, pageCount: 100 }).length);
    }

    expect([...widths]).toEqual([7]);
  });

  /*
   * What fills the space, stated for both ends, because "seven entries" on its
   * own is satisfiable by padding with anything. Near the start there is
   * nothing to elide on the left, so the slots a leading gap would have taken
   * go to real pages — and the current page stops being centred, which is the
   * trade: a window that always centres cannot also have a constant width at
   * the edges.
   */
  it("spends the leading gap's slots on real pages at the start", () => {
    expect(paginationRange({ page: 1, pageCount: 100 })).toEqual([
      page(1),
      page(2),
      page(3),
      page(4),
      page(5),
      gap("end"),
      page(100),
    ]);
  });

  it("spends the trailing gap's slots on real pages at the end", () => {
    expect(paginationRange({ page: 100, pageCount: 100 })).toEqual([
      page(1),
      gap("start"),
      page(96),
      page(97),
      page(98),
      page(99),
      page(100),
    ]);
  });
  /*
   * A gap that hides a single page is a worse entry than the page it hides.
   * It occupies the same slot, it is not a target, and it asks the reader to
   * take two steps — page to 3, then page to 2 — to reach something that could
   * have been there all along. Both ends of the range can produce one, and
   * neither is visible from any expectation written so far: these are the two
   * pages either side of where the edge blocks currently stop.
   */
  it("shows the page a leading gap would have stood for on its own", () => {
    expect(paginationRange({ page: 4, pageCount: 100 })).toEqual([
      page(1),
      page(2),
      page(3),
      page(4),
      page(5),
      gap("end"),
      page(100),
    ]);
  });

  it("shows the page a trailing gap would have stood for on its own", () => {
    expect(paginationRange({ page: 97, pageCount: 100 })).toEqual([
      page(1),
      gap("start"),
      page(96),
      page(97),
      page(98),
      page(99),
      page(100),
    ]);
  });
  /*
   * Inputs a caller reaches by accident rather than by asking.
   *
   * These four passed the moment they were written, which makes them
   * characterisation tests and not a step of the kata — they pin behaviour
   * that fell out of the arithmetic instead of driving any. They are here
   * because all four are reachable from a real screen: a filter that matches
   * nothing leaves `pageCount` at 0, and a filter applied while the reader is
   * on page 12 of 40 leaves `page` past the end of a range that is now 3 long.
   *
   * Clamping to the nearest end is the behaviour worth pinning, because the
   * alternative is a control with no current page in it at all.
   */
  it("renders nothing when there is nothing to page through", () => {
    expect(paginationRange({ page: 1, pageCount: 0 })).toEqual([]);
  });

  it("renders the one page of a single-page range", () => {
    expect(paginationRange({ page: 1, pageCount: 1 })).toEqual([page(1)]);
  });

  it("treats a page before the range as the first page", () => {
    expect(paginationRange({ page: 0, pageCount: 100 })).toEqual(
      paginationRange({ page: 1, pageCount: 100 }),
    );
  });

  it("treats a page past the range as the last page", () => {
    expect(paginationRange({ page: 500, pageCount: 100 })).toEqual(
      paginationRange({ page: 100, pageCount: 100 }),
    );
  });
});
