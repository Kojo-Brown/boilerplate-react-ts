import { describe, expect, it } from "vitest";
import {
  CsvHeaderError,
  DEFAULT_CHUNK_ROWS,
  MAX_ROW_ERRORS,
  createTransactionParser,
  formatMinor,
  parseAmountMinor,
  parseTransactionsCsv,
  readRecord,
} from "@/shared/lib/csvParser";
import { buildSampleCsv } from "@/shared/lib/sampleCsv";

const HEADER = "id,date,category,amount";
const csv = (...rows: string[]): string => [HEADER, ...rows].join("\n");

describe("readRecord", () => {
  it("returns null once the input is exhausted", () => {
    expect(readRecord("a,b", 3)).toBeNull();
    expect(readRecord("", 0)).toBeNull();
  });

  it("splits plain fields and reports where the next record starts", () => {
    expect(readRecord("a,b,c\nd", 0)).toEqual({ fields: ["a", "b", "c"], next: 6 });
  });

  it("consumes CRLF as one line ending", () => {
    expect(readRecord("a,b\r\nc", 0)).toEqual({ fields: ["a", "b"], next: 5 });
  });

  it("consumes a lone CR as a line ending", () => {
    expect(readRecord("a,b\rc", 0)).toEqual({ fields: ["a", "b"], next: 4 });
  });

  it("reads a quoted field containing the delimiter", () => {
    expect(readRecord('a,"b,c",d', 0)).toEqual({ fields: ["a", "b,c", "d"], next: 9 });
  });

  it("reads a quoted field containing a newline", () => {
    expect(readRecord('"a\nb",c', 0)).toEqual({ fields: ["a\nb", "c"], next: 7 });
  });

  it('unescapes "" to a single quote, more than once in a field', () => {
    expect(readRecord('"say ""hi"" twice",x', 0)?.fields).toEqual(['say "hi" twice', "x"]);
  });

  it("keeps characters between a closing quote and the delimiter", () => {
    // Not valid CSV. Discarding the stray `x` would lose data with no trace;
    // keeping it means the malformed value reaches row validation, which
    // reports it with a line number.
    expect(readRecord('"a"x,b', 0)?.fields).toEqual(["ax", "b"]);
  });

  it("treats an unterminated quote as one field running to the end", () => {
    expect(readRecord('a,"b,c\nd', 0)).toEqual({ fields: ["a", "b,c\nd"], next: 8 });
  });

  it("yields one empty field for a blank line", () => {
    expect(readRecord("\nx", 0)).toEqual({ fields: [""], next: 1 });
  });

  it("preserves empty fields at both ends", () => {
    expect(readRecord(",a,", 0)?.fields).toEqual(["", "a", ""]);
  });
});

describe("parseAmountMinor", () => {
  it.each([
    ["0", 0],
    ["1", 100],
    ["1.5", 150],
    ["1.05", 105],
    ["-12.34", -1234],
    ["-0.01", -1],
    ["1000000.99", 100000099],
  ])("parses %s", (input, expected) => {
    expect(parseAmountMinor(input)).toBe(expected);
  });

  it("keeps the arithmetic exact where a float would not", () => {
    // `Math.round(Number("8.115") * 100)` is 811 via 811.4999…, and a cent lost
    // per few thousand rows is a total that disagrees with the file.
    expect(parseAmountMinor("8.11")).toBe(811);
    expect(parseAmountMinor("1.15")).toBe(115);
    expect(parseAmountMinor("4.35")).toBe(435);
  });

  it.each(["", " ", "1.", ".5", "+1", "1e3", "1.234", "abc", "NaN", "Infinity", "--1"])(
    "rejects %o, which Number() would have taken",
    (input) => {
      expect(parseAmountMinor(input)).toBeNull();
    },
  );
});

describe("formatMinor", () => {
  it.each([
    [0, "0.00"],
    [5, "0.05"],
    [150, "1.50"],
    [-1234, "-12.34"],
    [-5, "-0.05"],
  ])("formats %i as %s", (minor, expected) => {
    expect(formatMinor(minor)).toBe(expected);
  });
});

describe("createTransactionParser", () => {
  it("rejects a file whose header is not the expected columns", () => {
    expect(() => createTransactionParser("id,date,category\n")).toThrow(CsvHeaderError);
    expect(() => createTransactionParser("id,date,category,total\n")).toThrow(CsvHeaderError);
  });

  it("rejects empty input, naming what it found", () => {
    let thrown: unknown;
    try {
      createTransactionParser("");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CsvHeaderError);
    expect((thrown as CsvHeaderError).received).toEqual([]);
  });

  it("tolerates whitespace around the header names", () => {
    expect(() => createTransactionParser("id, date , category,amount\n")).not.toThrow();
  });

  it("aggregates rows by category", () => {
    const result = parseTransactionsCsv(
      csv(
        "tx-1,2024-01-01,groceries,10.00",
        "tx-2,2024-01-02,groceries,-4.50",
        "tx-3,2024-01-03,transport,2.25",
      ),
    );

    expect(result.rowCount).toBe(3);
    expect(result.totalMinor).toBe(1000 - 450 + 225);
    expect(result.categories).toEqual([
      { category: "groceries", count: 2, totalMinor: 550, minMinor: -450, maxMinor: 1000 },
      { category: "transport", count: 1, totalMinor: 225, minMinor: 225, maxMinor: 225 },
    ]);
    expect(Array.from(result.amountsMinor)).toEqual([1000, -450, 225]);
  });

  it("orders categories by absolute total so a large refund still ranks", () => {
    const result = parseTransactionsCsv(
      csv("a,2024-01-01,small,1.00", "b,2024-01-01,refund,-99.00"),
    );
    expect(result.categories.map((c) => c.category)).toEqual(["refund", "small"]);
  });

  it("breaks a tie on absolute total by category name", () => {
    const result = parseTransactionsCsv(csv("a,2024-01-01,zeta,5.00", "b,2024-01-01,alpha,-5.00"));
    expect(result.categories.map((c) => c.category)).toEqual(["alpha", "zeta"]);
  });

  it("ignores a trailing newline rather than counting it as a row or an error", () => {
    const result = parseTransactionsCsv(`${csv("tx-1,2024-01-01,groceries,10.00")}\n`);
    expect(result.rowCount).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("reports bad rows with the source line number and carries on", () => {
    const result = parseTransactionsCsv(
      csv(
        "tx-1,2024-01-01,groceries,10.00",
        "tx-2,01/02/2024,groceries,1.00",
        "tx-3,2024-01-03,groceries,ten",
        ",2024-01-04,groceries,1.00",
        "tx-5,2024-01-05,,1.00",
        "tx-6,2024-01-06,groceries",
        "tx-7,2024-01-07,transport,3.00",
      ),
    );

    expect(result.rowCount).toBe(2);
    expect(result.errors).toEqual([
      { line: 3, message: 'Invalid date "01/02/2024" — expected YYYY-MM-DD.' },
      { line: 4, message: 'Invalid amount "ten".' },
      { line: 5, message: "Missing id." },
      { line: 6, message: "Missing category." },
      { line: 7, message: "Expected 4 columns, found 3." },
    ]);
    expect(result.droppedErrorCount).toBe(0);
  });

  it(`keeps at most ${String(MAX_ROW_ERRORS)} errors and counts the rest`, () => {
    const bad = Array.from({ length: MAX_ROW_ERRORS + 7 }, (_, i) => `tx-${String(i)},nope,x,1.00`);
    const result = parseTransactionsCsv(csv(...bad));
    expect(result.errors).toHaveLength(MAX_ROW_ERRORS);
    expect(result.droppedErrorCount).toBe(7);
  });

  it("parses a quoted category containing a comma", () => {
    const result = parseTransactionsCsv(csv('tx-1,2024-01-01,"food, drink",7.00'));
    expect(result.categories).toEqual([
      { category: "food, drink", count: 1, totalMinor: 700, minMinor: 700, maxMinor: 700 },
    ]);
  });

  it("reports progress that reaches the end of the input", () => {
    const text = buildSampleCsv(200, { seed: 3 });
    const parser = createTransactionParser(text);

    expect(parser.progress()).toMatchObject({ rowsParsed: 0, totalChars: text.length });

    expect(parser.step(50)).toBe(true);
    const mid = parser.progress();
    expect(mid.rowsParsed).toBe(50);
    expect(mid.ratio).toBeGreaterThan(0);
    expect(mid.ratio).toBeLessThan(1);

    while (parser.step(50)) {
      // Drain.
    }
    const end = parser.progress();
    expect(end.rowsParsed).toBe(200);
    expect(end.ratio).toBe(1);
    expect(end.charsParsed).toBe(text.length);
  });

  it("produces the same result whatever the chunk size", () => {
    const text = buildSampleCsv(1_500, { seed: 11, invalidEvery: 37 });
    const whole = parseTransactionsCsv(text);

    for (const chunkRows of [1, 7, 500, DEFAULT_CHUNK_ROWS]) {
      const parser = createTransactionParser(text);
      while (parser.step(chunkRows)) {
        // Drain.
      }
      const chunked = parser.result();
      expect(chunked.rowCount).toBe(whole.rowCount);
      expect(chunked.totalMinor).toBe(whole.totalMinor);
      expect(chunked.categories).toEqual(whole.categories);
      expect(chunked.errors).toEqual(whole.errors);
      expect(Array.from(chunked.amountsMinor)).toEqual(Array.from(whole.amountsMinor));
    }
  });

  it("grows the amounts buffer past its initial capacity without losing a value", () => {
    // The buffer starts at 1024 and doubles; 3000 rows crosses two growths, and
    // an off-by-one in `set` would show up as a zero in the middle.
    const result = parseTransactionsCsv(buildSampleCsv(3_000, { seed: 5 }));
    expect(result.amountsMinor).toHaveLength(3_000);
    expect(result.amountsMinor.reduce((sum, v) => sum + v, 0)).toBe(result.totalMinor);
  });

  it("returns a view over the buffer rather than a copy of it", () => {
    // The result is transferred, not cloned, so `amountsMinor` has to be backed
    // by a real `ArrayBuffer`. A `number[]` would have nothing to transfer.
    const result = parseTransactionsCsv(csv("tx-1,2024-01-01,x,1.00"));
    expect(result.amountsMinor.buffer).toBeInstanceOf(ArrayBuffer);
    expect(result.amountsMinor.byteOffset).toBe(0);
  });

  it("handles a header with no data rows", () => {
    const result = parseTransactionsCsv(`${HEADER}\n`);
    expect(result).toMatchObject({ rowCount: 0, totalMinor: 0, categories: [], errors: [] });
    expect(result.amountsMinor).toHaveLength(0);
  });
});
