import { describe, it, expect } from "vitest";
import {
  DEFAULT_ITEM_COUNT,
  MAX_ITEM_COUNT,
  parseItemCount,
  parseMode,
} from "@/pages/concurrencyLabParams";

describe("parseMode", () => {
  it("reads blocking mode", () => {
    expect(parseMode("blocking")).toBe("blocking");
  });

  it("reads concurrent mode", () => {
    expect(parseMode("concurrent")).toBe("concurrent");
  });

  it("defaults to concurrent when absent", () => {
    expect(parseMode(null)).toBe("concurrent");
  });

  it("defaults to concurrent for an unknown value", () => {
    expect(parseMode("Blocking")).toBe("concurrent");
    expect(parseMode("nonsense")).toBe("concurrent");
  });
});

describe("parseItemCount", () => {
  it("reads a positive integer", () => {
    expect(parseItemCount("2500")).toBe(2500);
  });

  it("truncates a fractional count", () => {
    expect(parseItemCount("2500.9")).toBe(2500);
  });

  it("defaults when absent", () => {
    expect(parseItemCount(null)).toBe(DEFAULT_ITEM_COUNT);
  });

  it("defaults for an empty or whitespace value", () => {
    // `Number("")` is 0, not NaN — the empty case needs its own guard.
    expect(parseItemCount("")).toBe(DEFAULT_ITEM_COUNT);
    expect(parseItemCount("   ")).toBe(DEFAULT_ITEM_COUNT);
  });

  it("defaults for a non-numeric value", () => {
    expect(parseItemCount("not-a-number")).toBe(DEFAULT_ITEM_COUNT);
  });

  it("defaults for zero and negative values", () => {
    expect(parseItemCount("0")).toBe(DEFAULT_ITEM_COUNT);
    expect(parseItemCount("-500")).toBe(DEFAULT_ITEM_COUNT);
  });

  it("defaults for a non-finite value", () => {
    expect(parseItemCount("Infinity")).toBe(DEFAULT_ITEM_COUNT);
  });

  it("clamps to the maximum", () => {
    expect(parseItemCount("999999")).toBe(MAX_ITEM_COUNT);
  });

  it("leaves a value at the maximum untouched", () => {
    expect(parseItemCount(String(MAX_ITEM_COUNT))).toBe(MAX_ITEM_COUNT);
  });
});
