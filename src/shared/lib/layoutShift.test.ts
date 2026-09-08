import { describe, it, expect } from "vitest";
import { accumulateShifts, rateCls, type LayoutShiftLike } from "@/shared/lib/layoutShift";

function shift(startTime: number, value: number, hadRecentInput = false): LayoutShiftLike {
  return { startTime, value, hadRecentInput };
}

describe("accumulateShifts", () => {
  it("is zero for a page that never moved", () => {
    expect(accumulateShifts([])).toEqual({ cls: 0, total: 0, excluded: 0 });
  });

  it("sums shifts that fall inside one session window", () => {
    const totals = accumulateShifts([shift(100, 0.05), shift(600, 0.07)]);
    expect(totals.cls).toBeCloseTo(0.12);
  });

  it("reports the worst window rather than the running total", () => {
    // Three windows of 0.05, 0.2 and 0.05. A total would say 0.3 and grade the
    // page poor; the experience was a single 0.2 jump.
    const totals = accumulateShifts([shift(0, 0.05), shift(2_000, 0.2), shift(4_000, 0.05)]);
    expect(totals.cls).toBeCloseTo(0.2);
    expect(totals.total).toBeCloseTo(0.3);
  });

  it("closes a window after a gap of more than a second", () => {
    const joined = accumulateShifts([shift(0, 0.1), shift(900, 0.1)]);
    const split = accumulateShifts([shift(0, 0.1), shift(1_500, 0.1)]);
    expect(joined.cls).toBeCloseTo(0.2);
    expect(split.cls).toBeCloseTo(0.1);
  });

  it("closes a window after five seconds however continuous the shifting", () => {
    // One shift every 500ms for six seconds: no gap ever exceeds a second, so
    // only the five-second cap stops the window growing without bound.
    const entries = Array.from({ length: 13 }, (_, index) => shift(index * 500, 0.02));
    const totals = accumulateShifts(entries);
    expect(totals.total).toBeCloseTo(0.26);
    // Entries at 0…5000 make the first window; 5500 starts the next.
    expect(totals.cls).toBeCloseTo(0.22);
  });

  it("excludes shifts the user caused, and says how much it excluded", () => {
    const totals = accumulateShifts([shift(100, 0.3, true), shift(2_000, 0.04)]);
    expect(totals.cls).toBeCloseTo(0.04);
    expect(totals.excluded).toBeCloseTo(0.3);
    expect(totals.total).toBeCloseTo(0.34);
  });

  it("does not let an excluded shift extend the window it fell in", () => {
    // The excluded entry sits between two counted ones and more than a second
    // from each. Treating it as window activity would join them into 0.2.
    const totals = accumulateShifts([shift(0, 0.1), shift(1_200, 0.5, true), shift(2_400, 0.1)]);
    expect(totals.cls).toBeCloseTo(0.1);
  });
});

describe("rateCls", () => {
  it("grades against the Core Web Vitals thresholds", () => {
    expect(rateCls(0)).toBe("good");
    expect(rateCls(0.1)).toBe("good");
    expect(rateCls(0.11)).toBe("needs-improvement");
    expect(rateCls(0.25)).toBe("needs-improvement");
    expect(rateCls(0.26)).toBe("poor");
  });
});
