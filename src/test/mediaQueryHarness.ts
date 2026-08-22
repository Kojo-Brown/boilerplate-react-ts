import { act } from "@testing-library/react";
import { vi, type Mock } from "vitest";

type ChangeListener = (event: MediaQueryListEvent) => void;

export interface MediaQueryHarness {
  /** Set a query's answer and notify anything subscribed to it. */
  setMatches: (query: string, matches: boolean) => void;
  /**
   * Run something the moment a subscription is added, before it is live.
   *
   * This is the only way to reproduce the race that decides between
   * `useSyncExternalStore` and `useEffect` + `useState`: a change that lands
   * after a component has read the value but before its listener is attached.
   */
  onSubscribe: (handler: (query: string) => void) => void;
  /** Every `addEventListener("change", …)`, as `(query, listener)`. */
  addEventListener: Mock<(query: string, listener: ChangeListener) => void>;
  /** Every `removeEventListener("change", …)`, as `(query, listener)`. */
  removeEventListener: Mock<(query: string, listener: ChangeListener) => void>;
  restore: () => void;
}

/**
 * A controllable `window.matchMedia`.
 *
 * `src/test/matchMedia.ts` installs a stub that answers "no match" to
 * everything, which is all most tests need. This one is for the tests that are
 * *about* media queries: it answers per query, fires change events on demand,
 * and records subscribe/unsubscribe calls so a test can assert how many there
 * were — the failure mode of an unstable `subscribe` is a hook that behaves
 * perfectly while re-subscribing on every commit, and counting is the only way
 * to see it.
 *
 * Every returned `MediaQueryList` is a fresh object, exactly as a browser's
 * is. That matters here: `useMediaQuery` calls `matchMedia` again on every
 * snapshot read, so a harness that handed out one shared object would hide a
 * whole class of mistake.
 */
export function installMediaQueryHarness(): MediaQueryHarness {
  const matches = new Map<string, boolean>();
  const listeners = new Map<string, Set<ChangeListener>>();
  let onSubscribeHandler: ((query: string) => void) | null = null;

  const addEventListener = vi.fn((query: string, listener: ChangeListener) => {
    const forQuery = listeners.get(query) ?? new Set<ChangeListener>();
    forQuery.add(listener);
    listeners.set(query, forQuery);
    onSubscribeHandler?.(query);
  });

  const removeEventListener = vi.fn((query: string, listener: ChangeListener) => {
    listeners.get(query)?.delete(listener);
  });

  function createList(query: string): MediaQueryList {
    return {
      get matches() {
        return matches.get(query) ?? false;
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: unknown) => {
        addEventListener(query, listener as ChangeListener);
      },
      removeEventListener: (_type: string, listener: unknown) => {
        removeEventListener(query, listener as ChangeListener);
      },
      addListener: (listener: unknown) => {
        addEventListener(query, listener as ChangeListener);
      },
      removeListener: (listener: unknown) => {
        removeEventListener(query, listener as ChangeListener);
      },
      dispatchEvent: () => true,
    } as MediaQueryList;
  }

  const spy = vi.spyOn(window, "matchMedia").mockImplementation(createList);

  return {
    setMatches: (query, value) => {
      matches.set(query, value);
      act(() => {
        listeners.get(query)?.forEach((listener) => {
          listener({ matches: value, media: query } as MediaQueryListEvent);
        });
      });
    },
    onSubscribe: (handler) => {
      onSubscribeHandler = handler;
    },
    addEventListener,
    removeEventListener,
    restore: () => {
      spy.mockRestore();
    },
  };
}
