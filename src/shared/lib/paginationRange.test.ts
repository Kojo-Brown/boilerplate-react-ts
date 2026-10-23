import { describe, it, expect } from "vitest";
import { paginationRange } from "@/shared/lib/paginationRange";

/**
 * Step 1 of the kata, and the only step whose test is allowed to fail for a
 * boring reason: nothing is imported from anywhere, because
 * `paginationRange.ts` does not exist yet. `tsc` says so before Vitest gets
 * the chance to, which is the point — the first red is a *missing module*, not
 * a wrong answer, and it is still the fastest possible proof that the test
 * runner is wired to the thing under test.
 *
 * What the test says is the requirement, and it is deliberately the easy half
 * of it: a list short enough to show every page shows every page. See
 * `docs/tdd.md` for why the hard half is not written here.
 */
describe("paginationRange", () => {
  it("lists every page when they all fit", () => {
    expect(paginationRange({ page: 1, pageCount: 5 })).toEqual([1, 2, 3, 4, 5]);
  });
});
