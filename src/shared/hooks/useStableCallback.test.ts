import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useStableCallback } from "@/shared/hooks/useStableCallback";

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
    const { result, rerender } = renderHook(() => useStableCallback(() => Math.PI));
    const ref1 = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(ref1);
  });

  // The ref is written in a layout effect rather than during render, because
  // writing a ref during render is a Rules of React violation that
  // `react-hooks/refs` reports. The cost of that correctness fix is this
  // boundary: within the render pass itself the callback still closes over the
  // previous `fn`. Pinned here so the tradeoff is a decision, not a surprise.
  it("still delegates to the previous fn when called during render", () => {
    const calls: string[] = [];
    let duringRender: string | undefined;

    const { rerender } = renderHook(
      ({ tag }: { tag: string }) => {
        const stable = useStableCallback(() => tag);
        // Deliberately calling during render to observe the boundary. Do not
        // do this in real code — see the hook's docblock.
        duringRender = stable();
        calls.push(tag);
        return stable;
      },
      { initialProps: { tag: "first" } },
    );

    expect(duringRender).toBe("first");

    rerender({ tag: "second" });

    // The layout effect from the "first" commit had run, but the one for
    // "second" has not yet, so render still sees the older closure.
    expect(duringRender).toBe("first");
    expect(calls).toEqual(["first", "second"]);
  });

  it("delegates to the latest fn once the layout effect has flushed", () => {
    const { result, rerender } = renderHook(
      ({ tag }: { tag: string }) => useStableCallback(() => tag),
      { initialProps: { tag: "first" } },
    );

    rerender({ tag: "second" });

    // Called after commit, which is what this hook is for.
    expect(result.current()).toBe("second");
  });
});
