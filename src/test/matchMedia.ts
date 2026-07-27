/**
 * Minimal `window.matchMedia` implementation.
 *
 * jsdom does not implement the CSS Object Model media-query API, so any code
 * reading `prefers-color-scheme` (and any test spying on `matchMedia`) fails
 * with "can only spy on a function". This stub always reports no match; tests
 * that care about a specific query override it with `vi.spyOn`.
 */
export function installMatchMediaFallback(): void {
  if (typeof window === "undefined") return;
  if (typeof window.matchMedia === "function") return;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const listeners = new Set<(event: MediaQueryListEvent) => void>();
      const list: MediaQueryList = {
        matches: false,
        media: query,
        onchange: null,
        addEventListener: (_type, listener) =>
          listeners.add(listener as (event: MediaQueryListEvent) => void),
        removeEventListener: (_type, listener) =>
          listeners.delete(listener as (event: MediaQueryListEvent) => void),
        dispatchEvent: (event: Event) => {
          listeners.forEach((l) => { l(event as MediaQueryListEvent); });
          return true;
        },
        // Deprecated pre-EventTarget API, still called by some libraries.
        addListener: (listener) =>
          listeners.add(listener as unknown as (event: MediaQueryListEvent) => void),
        removeListener: (listener) =>
          listeners.delete(listener as unknown as (event: MediaQueryListEvent) => void),
      };
      return list;
    },
  });
}
