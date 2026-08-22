import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { installMediaQueryHarness, type MediaQueryHarness } from "@/test/mediaQueryHarness";

const WIDE = "(min-width: 48rem)";
const NARROW = "(max-width: 30rem)";

let media: MediaQueryHarness;

beforeEach(() => {
  media = installMediaQueryHarness();
});

afterEach(() => {
  media.restore();
});

describe("useMediaQuery", () => {
  it("reports the current match on the first render", () => {
    media.setMatches(WIDE, true);
    const { result } = renderHook(() => useMediaQuery(WIDE));
    expect(result.current).toBe(true);
  });

  it("re-renders when the query starts matching", () => {
    const { result } = renderHook(() => useMediaQuery(WIDE));
    expect(result.current).toBe(false);

    media.setMatches(WIDE, true);
    expect(result.current).toBe(true);
  });

  it("ignores changes to a query it is not watching", () => {
    const { result } = renderHook(() => useMediaQuery(WIDE));
    media.setMatches(NARROW, true);
    expect(result.current).toBe(false);
  });

  it("subscribes once, however many times the component re-renders", () => {
    // The whole point of `subscribe` being a `useCallback`. Without it the
    // hook still reports the right value — it just tears the listener down
    // and rebuilds it on every commit, which nothing else here would notice.
    const { rerender } = renderHook(() => useMediaQuery(WIDE));
    rerender();
    rerender();
    rerender();

    expect(media.addEventListener).toHaveBeenCalledTimes(1);
    expect(media.removeEventListener).not.toHaveBeenCalled();
  });

  it("moves the subscription when the query changes", () => {
    const { result, rerender } = renderHook(({ query }) => useMediaQuery(query), {
      initialProps: { query: WIDE },
    });

    media.setMatches(NARROW, true);
    expect(result.current).toBe(false);

    rerender({ query: NARROW });

    expect(media.removeEventListener).toHaveBeenCalledWith(WIDE, expect.any(Function));
    expect(media.addEventListener).toHaveBeenCalledWith(NARROW, expect.any(Function));
    expect(result.current).toBe(true);
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useMediaQuery(WIDE));
    unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith(WIDE, expect.any(Function));
  });

  it("catches a change that lands between the render and the subscription", () => {
    /*
     * The race `useSyncExternalStore` exists for, and the reason this hook is
     * not `useState` + `useEffect`.
     *
     * The harness flips the query to `true` at the instant the listener is
     * attached — after the render that read `false`, before any event can be
     * delivered. A state-and-effect implementation initialises state during
     * that first render and only starts listening afterwards, so this change
     * falls in the gap and the component reports `false` until something else
     * happens to move the query. `useSyncExternalStore` re-reads the snapshot
     * once the subscription is live and re-renders if it moved.
     */
    media.onSubscribe((query) => {
      media.setMatches(query, true);
    });

    const { result } = renderHook(() => useMediaQuery(WIDE));

    expect(result.current).toBe(true);
  });
});
