import { describe, it, expect, vi, afterEach } from "vitest";
import { isSessionExpired } from "@/entities/session/sessionExpiry";

describe("isSessionExpired", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is false for an expiry in the future", () => {
    expect(isSessionExpired(Date.now() + 60_000)).toBe(false);
  });

  it("is true for an expiry in the past", () => {
    expect(isSessionExpired(Date.now() - 1)).toBe(true);
  });

  it("treats an expiry of exactly now as expired", () => {
    vi.useFakeTimers();
    const now = Date.now();
    expect(isSessionExpired(now)).toBe(true);
  });

  it("flips as the clock crosses the expiry", () => {
    vi.useFakeTimers();
    const expiresAt = Date.now() + 1_000;
    expect(isSessionExpired(expiresAt)).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(isSessionExpired(expiresAt)).toBe(true);
  });
});
