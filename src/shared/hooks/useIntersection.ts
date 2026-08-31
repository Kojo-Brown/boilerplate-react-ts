import { useEffect, useState } from "react";

export interface UseIntersectionOptions {
  /**
   * The box intersection is measured against — the scroll container, or `null`
   * for the viewport.
   *
   * Passing the container is not interchangeable with leaving it `null`, and
   * the difference is invisible until {@link rootMargin} is non-zero. The
   * margin grows *the root's* box, so against the viewport a bottom margin
   * asks "how far past the browser window is this element", which for a
   * sentinel clipped inside a 400px-tall inner scroller is a question whose
   * answer never changes. The element still becomes visible and the observer
   * still fires — just at the moment it enters the container, with the margin
   * having bought nothing. See `docs/windowed-infinite-scroll.md`.
   */
  readonly root?: Element | null | undefined;
  readonly rootMargin?: string | undefined;
  /**
   * A single ratio rather than the array the DOM API accepts.
   *
   * An array literal is a new array on every render, so it would re-create the
   * observer on every render unless every caller remembered to memoize it. The
   * multi-threshold form answers "how much of this is showing", which is a
   * question for a scroll-linked animation, not for a tripwire.
   */
  readonly threshold?: number | undefined;
}

/** An observer answer, tagged with the element it was an answer about. */
interface Reading {
  readonly node: Element;
  readonly isIntersecting: boolean;
}

export interface UseIntersectionResult<T extends Element> {
  /** Attach to the element to observe. Stable across renders. */
  readonly ref: (node: T | null) => void;
  /** Whether the observed element currently meets the threshold. */
  readonly isIntersecting: boolean;
}

/**
 * Observe one element and report whether it is currently intersecting.
 *
 * Two things about this hook are deliberate, and both of them are the
 * difference between working and *silently* not working.
 *
 * ## The element is state, not a ref
 *
 * The obvious version keeps a `useRef` and reads `ref.current` in an effect.
 * That effect runs once, after the first commit — and if the element it wants
 * was not rendered on that pass, `ref.current` is `null`, the effect returns
 * early, and nothing ever re-runs it. A ref assignment does not schedule a
 * render, so the arrival of the element is not an event React can react to.
 * The observer is then never attached, with no error anywhere: the page looks
 * right, scrolls fine, and simply never loads a second page.
 *
 * That is not a hypothetical shape. A sentinel is usually rendered only once
 * there is a next page to fetch, i.e. only after the first query resolves,
 * i.e. never on the first commit. Holding the node in state makes its arrival
 * a render, and the effect's dependency on it makes attaching automatic.
 *
 * ## The result is state, not a callback
 *
 * `IntersectionObserver` reports *changes*. A hook that took an `onEnter`
 * callback would fire once when the sentinel came into view and then stay
 * quiet — correct for a tripwire, wrong for "keep loading while this is
 * visible". If loading a page leaves the sentinel still in view (a short page,
 * or a prefetch margin larger than the page's height), no boundary is crossed,
 * no callback fires, and loading stalls until the user scrolls again.
 *
 * Exposing the *state* lets the caller re-evaluate whenever anything else
 * changes — see the `useEffect` in `VirtualInfiniteList`, which re-fires on
 * `isFetchingNextPage` going false while `isIntersecting` never moved.
 *
 * `IntersectionObserver` is assumed to exist. It is not feature-detected on
 * purpose: a fallback that quietly reports "never intersecting" would turn a
 * missing API into exactly the silent no-load this hook is written to avoid.
 * jsdom does not implement it, so unit tests install `src/test/intersection.ts`
 * and a test that forgets fails loudly rather than passing vacuously.
 */
export function useIntersection<T extends Element>({
  root = null,
  rootMargin = "0px",
  threshold = 0,
}: UseIntersectionOptions = {}): UseIntersectionResult<T> {
  const [node, setNode] = useState<T | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);

  useEffect(() => {
    if (node === null) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // One callback can carry several entries for the same element when the
        // observer has been queueing; the last is the current state.
        const entry = entries[entries.length - 1];
        if (entry) setReading({ node, isIntersecting: entry.isIntersecting });
      },
      { root, rootMargin, threshold },
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [node, root, rootMargin, threshold]);

  // A reading belongs to the element it was taken from, so it is discarded by
  // *derivation* rather than by resetting the state when the element goes
  // away. Two reasons, and the second is the real one. Writing state in an
  // effect body to clear it is a cascading render, which
  // `react-hooks/set-state-in-effect` rejects; more importantly it is a render
  // late, so for one commit a detached or replaced element still reports the
  // previous one's answer — long enough for the caller's own effect to act on
  // it and ask for a page nothing is waiting for.
  const isIntersecting = reading !== null && reading.node === node && reading.isIntersecting;

  return { ref: setNode, isIntersecting };
}
