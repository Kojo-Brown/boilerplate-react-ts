import { describe, it, expect } from "vitest";
import {
  DEFAULT_LATENCY_MS,
  MAX_LATENCY_MS,
  parseLatency,
  parseServerMode,
} from "@/pages/optimistic-lab/optimisticLabParams";

describe("parseServerMode", () => {
  it("returns failing only for the exact token", () => {
    expect(parseServerMode("failing")).toBe("failing");
  });

  it("falls back to healthy for anything else", () => {
    expect(parseServerMode("healthy")).toBe("healthy");
    expect(parseServerMode(null)).toBe("healthy");
    expect(parseServerMode("")).toBe("healthy");
    expect(parseServerMode("Failing")).toBe("healthy");
    expect(parseServerMode("broken")).toBe("healthy");
  });
});

describe("parseLatency", () => {
  it("parses a usable value", () => {
    expect(parseLatency("800")).toBe(800);
  });

  it("accepts zero", () => {
    expect(parseLatency("0")).toBe(0);
  });

  it("floors a fractional value", () => {
    expect(parseLatency("120.9")).toBe(120);
  });

  it("clamps to the maximum", () => {
    expect(parseLatency(String(MAX_LATENCY_MS * 10))).toBe(MAX_LATENCY_MS);
  });

  it("falls back to the default for missing, blank, negative, or non-numeric input", () => {
    expect(parseLatency(null)).toBe(DEFAULT_LATENCY_MS);
    expect(parseLatency("")).toBe(DEFAULT_LATENCY_MS);
    expect(parseLatency("   ")).toBe(DEFAULT_LATENCY_MS);
    expect(parseLatency("-1")).toBe(DEFAULT_LATENCY_MS);
    expect(parseLatency("soon")).toBe(DEFAULT_LATENCY_MS);
    expect(parseLatency("Infinity")).toBe(DEFAULT_LATENCY_MS);
  });
});
