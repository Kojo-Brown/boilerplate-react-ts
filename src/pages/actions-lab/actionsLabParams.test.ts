import { describe, it, expect } from "vitest";
import {
  DEFAULT_INVITE_LATENCY_MS,
  MAX_INVITE_LATENCY_MS,
  parseInviteLatency,
  parseInviteServerMode,
} from "@/pages/actions-lab/actionsLabParams";

describe("parseInviteServerMode", () => {
  it("reads an explicit failing server", () => {
    expect(parseInviteServerMode("failing")).toBe("failing");
  });

  it("defaults to healthy when the param is missing", () => {
    expect(parseInviteServerMode(null)).toBe("healthy");
  });

  it("treats an unknown value as healthy", () => {
    expect(parseInviteServerMode("nonsense")).toBe("healthy");
  });
});

describe("parseInviteLatency", () => {
  it("reads a valid latency", () => {
    expect(parseInviteLatency("250")).toBe(250);
  });

  it("accepts zero", () => {
    expect(parseInviteLatency("0")).toBe(0);
  });

  it("floors a fractional value", () => {
    expect(parseInviteLatency("250.9")).toBe(250);
  });

  it("clamps above the maximum", () => {
    expect(parseInviteLatency("999999")).toBe(MAX_INVITE_LATENCY_MS);
  });

  it.each([null, "", "   ", "soon", "-1", "NaN"])("falls back for %o", (raw) => {
    expect(parseInviteLatency(raw)).toBe(DEFAULT_INVITE_LATENCY_MS);
  });
});
