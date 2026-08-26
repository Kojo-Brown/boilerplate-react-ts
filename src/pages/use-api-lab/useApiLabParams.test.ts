import { describe, it, expect } from "vitest";
import {
  DEFAULT_PROFILE_LATENCY_MS,
  MAX_PROFILE_LATENCY_MS,
  parseProfileLatency,
  parseProfileServerMode,
} from "@/pages/use-api-lab/useApiLabParams";

describe("parseProfileServerMode", () => {
  it("returns failing only for the exact value", () => {
    expect(parseProfileServerMode("failing")).toBe("failing");
  });

  it("falls back to healthy for anything else", () => {
    expect(parseProfileServerMode("healthy")).toBe("healthy");
    expect(parseProfileServerMode(null)).toBe("healthy");
    expect(parseProfileServerMode("")).toBe("healthy");
    expect(parseProfileServerMode("Failing")).toBe("healthy");
    expect(parseProfileServerMode("broken")).toBe("healthy");
  });
});

describe("parseProfileLatency", () => {
  it("parses a usable value", () => {
    expect(parseProfileLatency("0")).toBe(0);
    expect(parseProfileLatency("800")).toBe(800);
  });

  it("floors fractional values", () => {
    expect(parseProfileLatency("120.9")).toBe(120);
  });

  it("clamps to the maximum", () => {
    expect(parseProfileLatency("999999")).toBe(MAX_PROFILE_LATENCY_MS);
  });

  it("falls back to the default for missing or unusable input", () => {
    expect(parseProfileLatency(null)).toBe(DEFAULT_PROFILE_LATENCY_MS);
    expect(parseProfileLatency("")).toBe(DEFAULT_PROFILE_LATENCY_MS);
    expect(parseProfileLatency("   ")).toBe(DEFAULT_PROFILE_LATENCY_MS);
    expect(parseProfileLatency("soon")).toBe(DEFAULT_PROFILE_LATENCY_MS);
    expect(parseProfileLatency("-1")).toBe(DEFAULT_PROFILE_LATENCY_MS);
    expect(parseProfileLatency("Infinity")).toBe(DEFAULT_PROFILE_LATENCY_MS);
  });
});
