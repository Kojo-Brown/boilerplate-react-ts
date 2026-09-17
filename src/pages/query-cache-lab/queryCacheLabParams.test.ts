import { describe, it, expect } from "vitest";
import {
  parseFailingCall,
  parseLatency,
  DEFAULT_LATENCY_MS,
  MAX_LATENCY_MS,
} from "@/pages/query-cache-lab/queryCacheLabParams";

describe("parseFailingCall", () => {
  it("accepts each verb the fake server understands", () => {
    expect(parseFailingCall("create")).toBe("create");
    expect(parseFailingCall("setDone")).toBe("setDone");
    expect(parseFailingCall("remove")).toBe("remove");
    expect(parseFailingCall("none")).toBe("none");
  });

  it("falls back to a healthy server for anything else", () => {
    expect(parseFailingCall(null)).toBe("none");
    expect(parseFailingCall("")).toBe("none");
    expect(parseFailingCall("list")).toBe("none");
    expect(parseFailingCall("CREATE")).toBe("none");
  });
});

describe("parseLatency", () => {
  it("reads a number of milliseconds", () => {
    expect(parseLatency("1500")).toBe(1500);
    expect(parseLatency("0")).toBe(0);
  });

  it("falls back to the default when there is nothing usable", () => {
    expect(parseLatency(null)).toBe(DEFAULT_LATENCY_MS);
    expect(parseLatency("  ")).toBe(DEFAULT_LATENCY_MS);
    expect(parseLatency("soon")).toBe(DEFAULT_LATENCY_MS);
    expect(parseLatency("-1")).toBe(DEFAULT_LATENCY_MS);
  });

  it("clamps and floors, so the page cannot be made to hang from a URL", () => {
    expect(parseLatency("999999")).toBe(MAX_LATENCY_MS);
    expect(parseLatency("120.9")).toBe(120);
  });
});
