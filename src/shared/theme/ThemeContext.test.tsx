import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider, useTheme } from "@/shared/theme/ThemeContext";

// ── helpers ──────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

function makeMediaQuery(matches: boolean) {
  return {
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

// ── setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── tests ────────────────────────────────────────────────────────────────────

describe("ThemeProvider / useTheme", () => {
  it("throws when used outside provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useTheme())).toThrow(
      "useTheme must be used within a ThemeProvider",
    );
    spy.mockRestore();
  });

  it("defaults to system mode", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue(
      makeMediaQuery(false) as unknown as MediaQueryList,
    );
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.mode).toBe("system");
  });

  it("restores stored mode from localStorage", () => {
    localStorage.setItem("theme", "dark");
    vi.spyOn(window, "matchMedia").mockReturnValue(
      makeMediaQuery(false) as unknown as MediaQueryList,
    );
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.mode).toBe("dark");
  });

  it("persists mode changes to localStorage", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue(
      makeMediaQuery(false) as unknown as MediaQueryList,
    );
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => {
      result.current.setMode("light");
    });
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("isDark is true when mode is dark", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue(
      makeMediaQuery(false) as unknown as MediaQueryList,
    );
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => {
      result.current.setMode("dark");
    });
    expect(result.current.isDark).toBe(true);
  });

  it("isDark is false when mode is light regardless of OS", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue(
      makeMediaQuery(true) as unknown as MediaQueryList,
    );
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => {
      result.current.setMode("light");
    });
    expect(result.current.isDark).toBe(false);
  });

  it("isDark follows OS when mode is system and OS is dark", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue(
      makeMediaQuery(true) as unknown as MediaQueryList,
    );
    const { result } = renderHook(() => useTheme(), { wrapper });
    // mode is 'system' by default
    expect(result.current.isDark).toBe(true);
  });

  it("isDark is false when mode is system and OS is light", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue(
      makeMediaQuery(false) as unknown as MediaQueryList,
    );
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.isDark).toBe(false);
  });

  it("adds .dark class to documentElement when isDark", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue(
      makeMediaQuery(false) as unknown as MediaQueryList,
    );
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => {
      result.current.setMode("dark");
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes .dark class from documentElement when not isDark", () => {
    document.documentElement.classList.add("dark");
    vi.spyOn(window, "matchMedia").mockReturnValue(
      makeMediaQuery(false) as unknown as MediaQueryList,
    );
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => {
      result.current.setMode("light");
    });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("reacts to OS change event when in system mode", () => {
    let changeHandler: ((e: MediaQueryListEvent) => void) | undefined;
    const mq = {
      matches: false,
      addEventListener: vi.fn((_: string, fn: (e: MediaQueryListEvent) => void) => {
        changeHandler = fn;
      }),
      removeEventListener: vi.fn(),
    };
    vi.spyOn(window, "matchMedia").mockReturnValue(mq as unknown as MediaQueryList);

    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.isDark).toBe(false);

    act(() => changeHandler?.({ matches: true } as MediaQueryListEvent));
    expect(result.current.isDark).toBe(true);
  });

  // The `useMemo` that used to wrap this context value was removed when the
  // provider opted into the React Compiler. A provider's context value is the
  // one object where a lost identity is expensive — every consumer in the tree
  // re-renders — so the replacement memoization is asserted, not assumed.
  // These pass only because `vitest.config.ts` runs the suite through the
  // compiler.
  it("keeps the context value referentially stable across re-renders", () => {
    const { result, rerender } = renderHook(() => useTheme(), { wrapper });
    const first = result.current;

    rerender();
    rerender();

    expect(result.current).toBe(first);
  });

  it("produces a new context value when the theme actually changes", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    const first = result.current;

    act(() => {
      result.current.setMode("dark");
    });

    expect(result.current).not.toBe(first);
    expect(result.current.mode).toBe("dark");
  });
});
