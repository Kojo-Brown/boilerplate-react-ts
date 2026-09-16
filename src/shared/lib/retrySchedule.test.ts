import { describe, it, expect } from "vitest";
import {
  DEFAULT_BACKOFF,
  backoffWithJitterMs,
  parseRetryAfterMs,
  type BackoffOptions,
} from "@/shared/lib/retrySchedule";

const SCHEDULE: BackoffOptions = { baseDelayMs: 100, maxDelayMs: 1_000 };

/** 2026-09-16T12:00:00Z, so the HTTP-date cases have something to be relative to. */
const NOW = Date.UTC(2026, 8, 16, 12, 0, 0);

describe("backoffWithJitterMs", () => {
  it("doubles the ceiling per attempt", () => {
    const atCeiling = () => 1;
    expect(backoffWithJitterMs(0, SCHEDULE, atCeiling)).toBe(100);
    expect(backoffWithJitterMs(1, SCHEDULE, atCeiling)).toBe(200);
    expect(backoffWithJitterMs(2, SCHEDULE, atCeiling)).toBe(400);
    expect(backoffWithJitterMs(3, SCHEDULE, atCeiling)).toBe(800);
  });

  it("caps the ceiling at maxDelayMs", () => {
    const atCeiling = () => 1;
    // 100 × 2^4 is 1,600 — past the cap, and every attempt after it too.
    expect(backoffWithJitterMs(4, SCHEDULE, atCeiling)).toBe(1_000);
    expect(backoffWithJitterMs(20, SCHEDULE, atCeiling)).toBe(1_000);
  });

  it("draws from the whole interval rather than scaling a fixed delay", () => {
    expect(backoffWithJitterMs(2, SCHEDULE, () => 0)).toBe(0);
    expect(backoffWithJitterMs(2, SCHEDULE, () => 0.5)).toBe(200);
    expect(backoffWithJitterMs(2, SCHEDULE, () => 0.25)).toBe(100);
  });

  // The property the whole design rests on: two clients that failed at the same
  // instant must not come back at the same instant. A schedule without jitter
  // passes every assertion above and fails this one.
  it("decorrelates clients that failed together", () => {
    const draws = Array.from({ length: 200 }, (_, i) => (i + 0.5) / 200);
    const delays = new Set(draws.map((d) => backoffWithJitterMs(3, SCHEDULE, () => d)));
    expect(delays.size).toBeGreaterThan(100);
  });

  it("stays inside [0, ceiling] for any draw Math.random can produce", () => {
    // `Math.random` is [0, 1), so the ceiling itself is unreachable; the round
    // to whole milliseconds is what makes the upper bound inclusive here.
    for (const draw of [0, 0.000001, 0.3, 0.9999999]) {
      const delay = backoffWithJitterMs(1, SCHEDULE, () => draw);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(200);
    }
  });

  it("defaults to a sub-second first retry and an 8s cap", () => {
    expect(DEFAULT_BACKOFF.baseDelayMs).toBe(250);
    expect(backoffWithJitterMs(0, DEFAULT_BACKOFF, () => 1)).toBe(250);
    expect(backoffWithJitterMs(10, DEFAULT_BACKOFF, () => 1)).toBe(8_000);
  });

  it("uses Math.random and the default schedule when given neither", () => {
    const delay = backoffWithJitterMs(0);
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThanOrEqual(DEFAULT_BACKOFF.baseDelayMs);
  });
});

describe("parseRetryAfterMs", () => {
  it("reads delta-seconds", () => {
    expect(parseRetryAfterMs("30", NOW)).toBe(30_000);
    expect(parseRetryAfterMs(" 2 ", NOW)).toBe(2_000);
    expect(parseRetryAfterMs("0", NOW)).toBe(0);
  });

  it("reads an HTTP date", () => {
    const at = new Date(NOW + 45_000).toUTCString();
    // Whole seconds only in an HTTP date, so the millisecond field is lost.
    expect(parseRetryAfterMs(at, NOW)).toBeCloseTo(45_000, -3);
  });

  it("floors a date in the past at zero rather than returning a negative wait", () => {
    const at = new Date(NOW - 60_000).toUTCString();
    expect(parseRetryAfterMs(at, NOW)).toBe(0);
  });

  it("floors negative delta-seconds at zero", () => {
    expect(parseRetryAfterMs("-5", NOW)).toBe(0);
  });

  it("is undefined for an absent, empty or unparseable header", () => {
    expect(parseRetryAfterMs(null, NOW)).toBeUndefined();
    // Not 0: `Number("")` is 0, which would read an empty header as "retry now".
    expect(parseRetryAfterMs("", NOW)).toBeUndefined();
    expect(parseRetryAfterMs("   ", NOW)).toBeUndefined();
    expect(parseRetryAfterMs("soon", NOW)).toBeUndefined();
  });
});
