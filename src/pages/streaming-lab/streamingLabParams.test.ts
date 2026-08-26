import { describe, it, expect } from "vitest";
import {
  DEFAULT_REPORT_LATENCY_MS,
  MAX_REPORT_LATENCY_MS,
  parseBoundaryLayout,
  parseFailingSection,
  parseLoadingStrategy,
  parseReportLatency,
  reportLatencies,
} from "@/pages/streaming-lab/streamingLabParams";

describe("parseBoundaryLayout", () => {
  it("reads an explicit flat layout", () => {
    expect(parseBoundaryLayout("flat")).toBe("flat");
  });

  it("defaults to nested for anything else", () => {
    expect(parseBoundaryLayout("nested")).toBe("nested");
    expect(parseBoundaryLayout(null)).toBe("nested");
    expect(parseBoundaryLayout("")).toBe("nested");
    expect(parseBoundaryLayout("FLAT")).toBe("nested");
  });
});

describe("parseLoadingStrategy", () => {
  it("reads an explicit waterfall", () => {
    expect(parseLoadingStrategy("waterfall")).toBe("waterfall");
  });

  it("defaults to prefetching for anything else", () => {
    expect(parseLoadingStrategy("parallel")).toBe("parallel");
    expect(parseLoadingStrategy(null)).toBe("parallel");
    expect(parseLoadingStrategy("nonsense")).toBe("parallel");
  });
});

describe("parseFailingSection", () => {
  it("accepts each real section name", () => {
    expect(parseFailingSection("summary")).toBe("summary");
    expect(parseFailingSection("breakdown")).toBe("breakdown");
    expect(parseFailingSection("activity")).toBe("activity");
  });

  it("falls back to none for anything that is not a section", () => {
    expect(parseFailingSection(null)).toBe("none");
    expect(parseFailingSection("none")).toBe("none");
    expect(parseFailingSection("toString")).toBe("none");
  });
});

describe("parseReportLatency", () => {
  it("reads a usable number", () => {
    expect(parseReportLatency("400")).toBe(400);
    expect(parseReportLatency("0")).toBe(0);
  });

  it("falls back to the default for anything unusable", () => {
    expect(parseReportLatency(null)).toBe(DEFAULT_REPORT_LATENCY_MS);
    expect(parseReportLatency("  ")).toBe(DEFAULT_REPORT_LATENCY_MS);
    expect(parseReportLatency("soon")).toBe(DEFAULT_REPORT_LATENCY_MS);
    expect(parseReportLatency("-1")).toBe(DEFAULT_REPORT_LATENCY_MS);
    expect(parseReportLatency("Infinity")).toBe(DEFAULT_REPORT_LATENCY_MS);
  });

  it("clamps and truncates", () => {
    expect(parseReportLatency("999999")).toBe(MAX_REPORT_LATENCY_MS);
    expect(parseReportLatency("120.9")).toBe(120);
  });
});

describe("reportLatencies", () => {
  it("keeps the summary fastest and the breakdown slowest", () => {
    const latencies = reportLatencies(1_000);

    // The ordering is what the demo rests on: the shell has to arrive well
    // before the sections, and activity has to beat the breakdown so reveal
    // order visibly disagrees with source order.
    expect(latencies.summary).toBeLessThan(latencies.activity);
    expect(latencies.activity).toBeLessThan(latencies.breakdown);
  });

  it("scales with the base and stays integral", () => {
    const fast = reportLatencies(400);
    const slow = reportLatencies(3_000);

    for (const section of ["summary", "breakdown", "activity"] as const) {
      expect(Number.isInteger(fast[section])).toBe(true);
      expect(slow[section]).toBeGreaterThan(fast[section]);
    }
    expect(reportLatencies(1_000).breakdown).toBe(1_000);
  });
});
