import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARSE_MODE,
  DEFAULT_ROW_COUNT,
  ROW_COUNT_OPTIONS,
  formatBytes,
  parseParseMode,
  parseRowCount,
} from "@/pages/worker-lab/workerLabParams";

describe("parseRowCount", () => {
  it.each(ROW_COUNT_OPTIONS)("accepts the offered option %i", (option) => {
    expect(parseRowCount(String(option))).toBe(option);
  });

  it.each([null, "", "abc", "0", "-1", "12345", "1e5", "50000.5"])(
    "falls back to the default for %o",
    (raw) => {
      expect(parseRowCount(raw)).toBe(DEFAULT_ROW_COUNT);
    },
  );

  it("does not accept a value that merely coerces to an option", () => {
    // `Number(" 50000 ")` is 50000, and a URL that round-trips through
    // whitespace should not quietly select an option the buttons cannot.
    expect(parseRowCount(" 50000 ")).toBe(50_000);
    expect(parseRowCount("50_000")).toBe(DEFAULT_ROW_COUNT);
  });
});

describe("parseParseMode", () => {
  it("accepts both arms", () => {
    expect(parseParseMode("worker")).toBe("worker");
    expect(parseParseMode("main")).toBe("main");
  });

  it.each([null, "", "Worker", "thread", "true"])("falls back for %o", (raw) => {
    expect(parseParseMode(raw)).toBe(DEFAULT_PARSE_MODE);
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1.0 KiB"],
    [1536, "1.5 KiB"],
    [1024 * 1024, "1.0 MiB"],
    [3 * 1024 * 1024 + 512 * 1024, "3.5 MiB"],
  ])("formats %i as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
