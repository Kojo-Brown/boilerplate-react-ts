import { describe, expect, it } from "vitest";
import { SAMPLE_CATEGORIES, buildSampleCsv } from "@/shared/lib/sampleCsv";
import { parseTransactionsCsv } from "@/shared/lib/csvParser";

describe("buildSampleCsv", () => {
  it("emits a header and one line per row", () => {
    const text = buildSampleCsv(5);
    const lines = text.trimEnd().split("\n");
    expect(lines[0]).toBe("id,date,category,amount");
    expect(lines).toHaveLength(6);
  });

  it("produces byte-identical output for the same seed and size", () => {
    expect(buildSampleCsv(500, { seed: 42 })).toBe(buildSampleCsv(500, { seed: 42 }));
  });

  it("produces different output for a different seed", () => {
    expect(buildSampleCsv(500, { seed: 1 })).not.toBe(buildSampleCsv(500, { seed: 2 }));
  });

  it("extends rather than reshuffles when the row count grows", () => {
    // The benchmark compares 10k against 200k of the *same* data. A generator
    // keyed on the row count would silently be comparing two different files.
    const small = buildSampleCsv(100, { seed: 9 }).trimEnd().split("\n");
    const large = buildSampleCsv(400, { seed: 9 }).trimEnd().split("\n");
    expect(large.slice(0, 101)).toEqual(small);
  });

  it("quotes the category that contains a comma and nothing else", () => {
    const lines = buildSampleCsv(400, { seed: 4 }).trimEnd().split("\n").slice(1);
    const quoted = lines.filter((line) => line.includes('"'));
    expect(quoted.length).toBeGreaterThan(0);
    for (const line of quoted) expect(line).toContain('"food, drink"');
  });

  it("parses cleanly, with every category represented", () => {
    const result = parseTransactionsCsv(buildSampleCsv(2_000, { seed: 8 }));
    expect(result.rowCount).toBe(2_000);
    expect(result.errors).toEqual([]);
    expect(result.categories.map((c) => c.category).sort()).toEqual([...SAMPLE_CATEGORIES].sort());
  });

  it("emits exactly one malformed row per `invalidEvery`", () => {
    const result = parseTransactionsCsv(buildSampleCsv(100, { seed: 2, invalidEvery: 10 }));
    expect(result.rowCount).toBe(90);
    expect(result.errors).toHaveLength(10);
    expect(result.errors[0]).toEqual({
      line: 11,
      message: 'Invalid date "not-a-date" — expected YYYY-MM-DD.',
    });
  });

  it("stays within the stated amount range", () => {
    const result = parseTransactionsCsv(buildSampleCsv(3_000, { seed: 6 }));
    for (const amount of result.amountsMinor) {
      expect(amount).toBeGreaterThanOrEqual(-50_000);
      expect(amount).toBeLessThanOrEqual(50_000);
    }
  });

  it("emits only the header for zero rows", () => {
    expect(buildSampleCsv(0)).toBe("id,date,category,amount\n");
  });
});
