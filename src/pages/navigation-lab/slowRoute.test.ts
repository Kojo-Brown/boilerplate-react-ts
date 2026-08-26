import { describe, it, expect, vi } from "vitest";
import {
  createSlowRouteCache,
  slowRouteKey,
  slowRouteLatency,
} from "@/pages/navigation-lab/slowRoute";

describe("slowRouteKey", () => {
  it("combines the latency and the run into one key", () => {
    expect(slowRouteKey(1500, 3)).toBe("1500:3");
  });

  it("gives a different key to each run so a repeat visit suspends again", () => {
    // A settled promise never suspends, so reusing a key would make the second
    // visit instant and leave the lab with nothing to demonstrate.
    expect(slowRouteKey(1500, 1)).not.toBe(slowRouteKey(1500, 2));
  });

  it("gives a different key to each latency", () => {
    expect(slowRouteKey(600, 1)).not.toBe(slowRouteKey(1500, 1));
  });
});

describe("slowRouteLatency", () => {
  it("reads the latency back out of a key", () => {
    expect(slowRouteLatency(slowRouteKey(1500, 3))).toBe(1500);
  });

  it("treats a malformed key as instant rather than throwing", () => {
    expect(slowRouteLatency("nonsense")).toBe(0);
    expect(slowRouteLatency("")).toBe(0);
  });

  it("treats a negative latency as instant", () => {
    expect(slowRouteLatency("-50:1")).toBe(0);
  });
});

describe("createSlowRouteCache", () => {
  it("sleeps for the latency the key asks for", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const cache = createSlowRouteCache(sleep);

    await cache.read(slowRouteKey(600, 1));

    expect(sleep).toHaveBeenCalledExactlyOnceWith(600);
  });

  it("returns the same promise for one run, so a render loop cannot restart it", async () => {
    // The precondition for `use()`: a fresh promise on every render pass means
    // the component suspends forever.
    const sleep = vi.fn().mockResolvedValue(undefined);
    const cache = createSlowRouteCache(sleep);
    const key = slowRouteKey(600, 1);

    const first = cache.read(key);
    const second = cache.read(key);

    expect(first).toBe(second);
    expect(sleep).toHaveBeenCalledTimes(1);
    await first;
  });

  it("starts a new sleep for a new run", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const cache = createSlowRouteCache(sleep);

    await cache.read(slowRouteKey(600, 1));
    await cache.read(slowRouteKey(600, 2));

    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("defaults to a real timer when nothing is injected", async () => {
    vi.useFakeTimers();
    try {
      const cache = createSlowRouteCache();
      let settled = false;
      void cache.read(slowRouteKey(50, 1)).then(() => {
        settled = true;
      });

      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(50);
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
