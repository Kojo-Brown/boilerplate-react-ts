import { useCallback, useEffect, useRef } from "react";
import { useIntersection } from "@/shared/hooks/useIntersection";
import { useRoutePrefetch } from "@/features/route-prefetch/routePrefetch";

/**
 * Which signals may start a prefetch for a link.
 *
 * `"hover"` covers pointer, keyboard focus and touch — everything that says
 * *this one*. `"viewport"` is the weaker guess, for links far enough down a
 * page that arriving at one is itself information.
 */
export type PrefetchTrigger = "none" | "hover" | "viewport" | "both";

export interface UsePrefetchTriggersOptions {
  href: string;
  trigger?: PrefetchTrigger | undefined;
  /**
   * How long a pointer must rest on the link before it counts as intent.
   *
   * Not zero. A pointer crossing a nav bar on its way somewhere else enters
   * and leaves every item in it, and at zero that is a request per link —
   * several chunk downloads bought with a gesture that meant nothing. ~65ms is
   * comfortably shorter than the ~200ms it takes to notice a link and press
   * it, so the prefetch still starts before the click on a real hover.
   */
  hoverDelayMs?: number | undefined;
  /**
   * How far outside the viewport a link counts as approaching.
   *
   * Grows the viewport box, so a link 200px below the fold trips at the
   * default — early enough to be useful, near enough that scrolling past it
   * was plausible.
   */
  rootMargin?: string | undefined;
}

/**
 * Props for the anchor. A `type` rather than an `interface` because
 * `mergeProps` constrains on `Record<string, unknown>`, which only an
 * anonymous object type satisfies implicitly.
 */
export type PrefetchTriggerProps = {
  ref: (node: HTMLAnchorElement | null) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocus: () => void;
  onTouchStart: () => void;
};

export const DEFAULT_HOVER_DELAY_MS = 65;
export const DEFAULT_ROOT_MARGIN = "200px";

/** Stable no-op ref for links that are not being observed. */
const NO_REF = (_node: HTMLAnchorElement | null): void => {
  // Nothing to hold: without viewport prefetching there is no observer, and
  // attaching the real ref anyway would construct one per link on the page.
};

/**
 * The hover and viewport wiring for one link.
 *
 * Three things here are the difference between prefetching and appearing to.
 *
 * **A dwell timer, and only for the pointer.** `onFocus` and `onTouchStart`
 * request immediately: neither has a dwell to measure. A keyboard user who has
 * tabbed to a link is at it, and a touch produces no hover at all — the
 * pointer events fire as part of the tap, a few milliseconds ahead of the
 * click, so a delay there would spend the whole window it had.
 *
 * **Leaving cancels, but only what has not started.** `cancel` unqueues; it
 * cannot abort a dispatched `import()`, because the module loader has no abort
 * signal. So the dwell is what does the real work of not fetching, and the
 * cancel is only for the window between the timer firing and the browser going
 * idle.
 *
 * **The observer is not created when it is not wanted.** The intersection ref
 * is swapped for a no-op rather than the hook being called conditionally, so a
 * nav of hover-only links constructs no `IntersectionObserver` at all — the
 * hook only observes once it is handed a node.
 */
export function usePrefetchTriggers({
  href,
  trigger = "hover",
  hoverDelayMs = DEFAULT_HOVER_DELAY_MS,
  rootMargin = DEFAULT_ROOT_MARGIN,
}: UsePrefetchTriggersOptions): PrefetchTriggerProps {
  const { request, cancel } = useRoutePrefetch();
  const wantsHover = trigger === "hover" || trigger === "both";
  const wantsViewport = trigger === "viewport" || trigger === "both";

  const { ref: observeRef, isIntersecting } = useIntersection<HTMLAnchorElement>({ rootMargin });
  const timer = useRef<number | null>(null);

  const clearDwell = useCallback(() => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => clearDwell, [clearDwell]);

  useEffect(() => {
    if (!wantsViewport || !isIntersecting) return;
    request(href, "viewport");
  }, [wantsViewport, isIntersecting, request, href]);

  const onPointerEnter = useCallback(() => {
    if (!wantsHover) return;
    clearDwell();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      request(href, "hover");
    }, hoverDelayMs);
  }, [wantsHover, clearDwell, hoverDelayMs, request, href]);

  const onPointerLeave = useCallback(() => {
    if (!wantsHover) return;
    clearDwell();
    cancel(href);
  }, [wantsHover, clearDwell, cancel, href]);

  const onCommit = useCallback(() => {
    if (!wantsHover) return;
    clearDwell();
    request(href, "hover");
  }, [wantsHover, clearDwell, request, href]);

  return {
    ref: wantsViewport ? observeRef : NO_REF,
    onPointerEnter,
    onPointerLeave,
    onFocus: onCommit,
    onTouchStart: onCommit,
  };
}
