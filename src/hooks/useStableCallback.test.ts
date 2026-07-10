import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useStableCallback } from "./useStableCallback";

describe("useStableCallback", () => {
  it("returns a stable function reference across re-renders", () => {
    const fn = vi.fn();
    const { result, rerender } = renderHook(() => useStableCallback(fn));
    const firstRef = result.current;
    rerender();
    expect(result.current).toBe(firstRef);
  });

  it("always calls the latest version of fn", () => {
    let count = 0;
    const getCount = () => count;
    const { result, rerender } = renderHook(() => useStableCallback(getCount));

    expect(result.current()).toBe(0);

    count = 42;
    rerender();
    expect(result.current()).toBe(42);
  });

  it("forwards all arguments to fn", () => {
    const add = vi.fn((a: number, b: number) => a + b);
    const { result } = renderHook(() => useStableCallback(add));
    const out = result.current(3, 4);
    expect(out).toBe(7);
    expect(add).toHaveBeenCalledWith(3, 4);
  });

  it("returns the return value of fn", () => {
    const greet = () => "hello";
    const { result } = renderHook(() => useStableCallback(greet));
    expect(result.current()).toBe("hello");
  });

  it("remains stable even when a new fn identity is passed each render", () => {
    const { result, rerender } = renderHook(() =>
      useStableCallback(() => Math.PI),
    );
    const ref1 = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(ref1);
  });
});
