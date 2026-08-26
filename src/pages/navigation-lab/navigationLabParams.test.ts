import { describe, it, expect } from "vitest";
import {
  DEFAULT_ROUTE_LATENCY_MS,
  MAX_ROUTE_LATENCY_MS,
  parseBoundaryPlacement,
  parseRouteLatency,
  parseRouteRun,
  slowRouteHref,
} from "@/pages/navigation-lab/navigationLabParams";

describe("parseBoundaryPlacement", () => {
  it("reads an explicit per-route placement", () => {
    expect(parseBoundaryPlacement("per-route")).toBe("per-route");
  });

  // The hoisted arm is what the app actually does, so it is what the lab shows
  // unless asked otherwise.
  it.each([["hoisted"], ["nonsense"], [null], [""]])("defaults %s to hoisted", (raw) => {
    expect(parseBoundaryPlacement(raw)).toBe("hoisted");
  });
});

describe("parseRouteLatency", () => {
  it("reads a valid latency", () => {
    expect(parseRouteLatency("600")).toBe(600);
  });

  it("accepts zero", () => {
    expect(parseRouteLatency("0")).toBe(0);
  });

  it("clamps to the maximum", () => {
    expect(parseRouteLatency("999999")).toBe(MAX_ROUTE_LATENCY_MS);
  });

  it("floors a fractional latency", () => {
    expect(parseRouteLatency("600.9")).toBe(600);
  });

  it.each([[null], [""], ["   "], ["abc"], ["-1"]])("falls back on %s", (raw) => {
    expect(parseRouteLatency(raw)).toBe(DEFAULT_ROUTE_LATENCY_MS);
  });
});

describe("parseRouteRun", () => {
  it("reads a run counter", () => {
    expect(parseRouteRun("4")).toBe(4);
  });

  it.each([[null], ["abc"], ["-2"]])("falls back to zero on %s", (raw) => {
    expect(parseRouteRun(raw)).toBe(0);
  });
});

describe("slowRouteHref", () => {
  it("carries the whole configuration, so a run is shareable", () => {
    expect(slowRouteHref("per-route", 600, 2)).toBe(
      "/labs/navigation/slow?boundary=per-route&latency=600&run=2",
    );
  });

  it("round-trips through the parsers", () => {
    const params = new URLSearchParams(slowRouteHref("hoisted", 5000, 7).split("?")[1]);
    expect(parseBoundaryPlacement(params.get("boundary"))).toBe("hoisted");
    expect(parseRouteLatency(params.get("latency"))).toBe(5000);
    expect(parseRouteRun(params.get("run"))).toBe(7);
  });
});
