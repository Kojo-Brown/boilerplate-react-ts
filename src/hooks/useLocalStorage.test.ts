import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLocalStorage } from "./useLocalStorage";

describe("useLocalStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the initial value when the key is absent", () => {
    const { result } = renderHook(() => useLocalStorage("missing", "fallback"));
    expect(result.current[0]).toBe("fallback");
  });

  it("does not write to storage until a value is set", () => {
    renderHook(() => useLocalStorage("untouched", "fallback"));
    expect(localStorage.getItem("untouched")).toBeNull();
  });

  it("hydrates from an existing stored value", () => {
    localStorage.setItem("greeting", JSON.stringify("stored"));
    const { result } = renderHook(() => useLocalStorage("greeting", "fallback"));
    expect(result.current[0]).toBe("stored");
  });

  it("hydrates structured values, not just strings", () => {
    localStorage.setItem("profile", JSON.stringify({ name: "Ada", tags: ["a", "b"] }));
    const { result } = renderHook(() =>
      useLocalStorage<{ name: string; tags: string[] }>("profile", { name: "", tags: [] }),
    );
    expect(result.current[0]).toEqual({ name: "Ada", tags: ["a", "b"] });
  });

  it("falls back to the initial value when stored JSON is malformed", () => {
    localStorage.setItem("broken", "{not json");
    const { result } = renderHook(() => useLocalStorage("broken", "fallback"));
    expect(result.current[0]).toBe("fallback");
  });

  it("falls back to the initial value when storage access throws", () => {
    // Swap the whole global rather than spying on a method: jsdom's Storage is
    // proxy-backed on some Node versions, and the in-memory fallback keeps its
    // methods as own properties on others — a method spy silently misses in
    // one environment or the other. Replacing the object works in both.
    const original = globalThis.localStorage;
    const getItem = vi.fn((_key: string): string | null => {
      throw new Error("storage disabled");
    });
    // Only getItem is exercised on the hook's init path, so the stub carries
    // nothing else (spreading `original` would also drop Storage's prototype).
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem },
    });

    try {
      const { result } = renderHook(() => useLocalStorage("blocked", "fallback"));
      expect(getItem).toHaveBeenCalledWith("blocked");
      expect(result.current[0]).toBe("fallback");
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });

  it("persists a directly assigned value", () => {
    const { result } = renderHook(() => useLocalStorage("count", 0));

    act(() => {
      result.current[1](5);
    });

    expect(result.current[0]).toBe(5);
    expect(localStorage.getItem("count")).toBe(JSON.stringify(5));
  });

  it("supports functional updates based on the previous value", () => {
    const { result } = renderHook(() => useLocalStorage("count", 1));

    act(() => {
      result.current[1]((prev) => prev + 41);
    });

    expect(result.current[0]).toBe(42);
    expect(localStorage.getItem("count")).toBe(JSON.stringify(42));
  });

  it("applies sequential functional updates cumulatively", () => {
    const { result } = renderHook(() => useLocalStorage("count", 0));

    act(() => {
      result.current[1]((prev) => prev + 1);
    });
    act(() => {
      result.current[1]((prev) => prev + 1);
    });

    expect(result.current[0]).toBe(2);
    expect(localStorage.getItem("count")).toBe(JSON.stringify(2));
  });

  it("remove clears the key and resets to the initial value", () => {
    const { result } = renderHook(() => useLocalStorage("session", "anonymous"));

    act(() => {
      result.current[1]("signed-in");
    });
    expect(localStorage.getItem("session")).toBe(JSON.stringify("signed-in"));

    act(() => {
      result.current[2]();
    });

    expect(result.current[0]).toBe("anonymous");
    expect(localStorage.getItem("session")).toBeNull();
  });

  it("keeps a stable setter identity across re-renders while the key is unchanged", () => {
    const { result, rerender } = renderHook(() => useLocalStorage("stable", "v"));
    const firstSetter = result.current[1];

    rerender();

    expect(result.current[1]).toBe(firstSetter);
  });

  it("writes under the new key after the key changes", () => {
    const { result, rerender } = renderHook(({ key }) => useLocalStorage(key, "v"), {
      initialProps: { key: "first" },
    });

    rerender({ key: "second" });
    act(() => {
      result.current[1]("written");
    });

    expect(localStorage.getItem("second")).toBe(JSON.stringify("written"));
    expect(localStorage.getItem("first")).toBeNull();
  });

  it("keeps separate keys independent", () => {
    const a = renderHook(() => useLocalStorage("a", 0));
    const b = renderHook(() => useLocalStorage("b", 0));

    act(() => {
      a.result.current[1](1);
    });

    expect(a.result.current[0]).toBe(1);
    expect(b.result.current[0]).toBe(0);
  });
});
