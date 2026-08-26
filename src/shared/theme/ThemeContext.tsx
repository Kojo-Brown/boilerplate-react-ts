import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";

export interface ThemeContextValue {
  /** The value explicitly chosen by the user (or 'system' if not set). */
  mode: ThemeMode;
  /** True when the effective (resolved) theme is dark. */
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
}

const STORAGE_KEY = "theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getStoredMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // localStorage unavailable (SSR / private browsing)
  }
  return "system";
}

function getOsDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Opted into the React Compiler (see `docs/react-compiler.md`).
 *
 * The `useCallback` around `setMode` and the `useMemo` around the context value
 * are both gone. A provider's context value is the case where hand-memoization
 * matters most — a new object identity re-renders every consumer in the tree —
 * and it is also the case where it is easiest to get subtly wrong. The compiler
 * derives both from the code, and `ThemeContext.test.tsx` asserts the value
 * stays referentially stable across re-renders that do not change the theme.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  "use memo";

  const [mode, setModeState] = useState<ThemeMode>(getStoredMode);
  const [osDark, setOsDark] = useState<boolean>(getOsDark);

  // Keep osDark in sync with the OS preference.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setOsDark(e.matches);
    };
    mq.addEventListener("change", handler);
    return () => {
      mq.removeEventListener("change", handler);
    };
  }, []);

  const isDark = mode === "dark" || (mode === "system" && osDark);

  // Apply / remove the `.dark` class on the root element.
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [isDark]);

  const setMode = (next: ThemeMode): void => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
    setModeState(next);
  };

  const value: ThemeContextValue = { mode, isDark, setMode };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
