import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { RouteTransitionHarness } from "@/test/routeTransitionHarness";
import { PrefetchNavLink } from "@/widgets/layout/PrefetchNavLink";
import { DEFAULT_HOVER_DELAY_MS } from "@/features/route-prefetch/usePrefetchTriggers";
import {
  createManualIdleScheduler,
  createStubChunkRegistry,
  type ManualIdleScheduler,
} from "@/test/prefetch";
import { installIntersectionObserver, type IntersectionHarness } from "@/test";

const ABOUT = "/about";

function renderLink(children: React.ReactNode) {
  const scheduler = createManualIdleScheduler();
  const chunks = createStubChunkRegistry([ABOUT]);

  render(
    <RouteTransitionHarness prefetchRegistry={chunks.registry} prefetchScheduler={scheduler}>
      {children}
    </RouteTransitionHarness>,
  );

  return { scheduler, chunks, link: screen.getByRole("link", { name: "About" }) };
}

function hover(link: HTMLElement, scheduler: ManualIdleScheduler): void {
  fireEvent.pointerEnter(link);
  act(() => {
    vi.advanceTimersByTime(DEFAULT_HOVER_DELAY_MS);
  });
  scheduler.flush();
}

describe("PrefetchNavLink", () => {
  let intersection: IntersectionHarness;

  beforeEach(() => {
    vi.useFakeTimers();
    intersection = installIntersectionObserver();
  });

  afterEach(() => {
    vi.useRealTimers();
    intersection.restore();
  });

  it("renders a real anchor to the destination", () => {
    const { link } = renderLink(<PrefetchNavLink to={ABOUT}>About</PrefetchNavLink>);
    expect(link).toHaveAttribute("href", ABOUT);
  });

  it("prefetches on hover by default", () => {
    const { scheduler, chunks, link } = renderLink(
      <PrefetchNavLink to={ABOUT}>About</PrefetchNavLink>,
    );

    hover(link, scheduler);

    expect(chunks.calls).toEqual([ABOUT]);
  });

  it("keeps the caller's pointer handler as well as its own", () => {
    // Spreading rather than merging would drop one of the two silently, and
    // which one it dropped would depend on the order of two spreads.
    const onPointerEnter = vi.fn();
    const { scheduler, chunks, link } = renderLink(
      <PrefetchNavLink to={ABOUT} onPointerEnter={onPointerEnter}>
        About
      </PrefetchNavLink>,
    );

    hover(link, scheduler);

    expect(onPointerEnter).toHaveBeenCalledTimes(1);
    expect(chunks.calls).toEqual([ABOUT]);
  });

  it("honours a custom dwell", () => {
    const { scheduler, chunks, link } = renderLink(
      <PrefetchNavLink to={ABOUT} prefetchDelayMs={500}>
        About
      </PrefetchNavLink>,
    );

    fireEvent.pointerEnter(link);
    act(() => {
      vi.advanceTimersByTime(DEFAULT_HOVER_DELAY_MS);
    });
    scheduler.flush();
    expect(chunks.calls).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(500 - DEFAULT_HOVER_DELAY_MS);
    });
    scheduler.flush();
    expect(chunks.calls).toEqual([ABOUT]);
  });

  it("prefetches nothing with prefetchOn=none", () => {
    const { scheduler, chunks, link } = renderLink(
      <PrefetchNavLink to={ABOUT} prefetchOn="none">
        About
      </PrefetchNavLink>,
    );

    hover(link, scheduler);

    expect(chunks.calls).toEqual([]);
    expect(intersection.observers).toHaveLength(0);
  });

  it("observes the anchor with prefetchOn=viewport", () => {
    const { scheduler, chunks, link } = renderLink(
      <PrefetchNavLink to={ABOUT} prefetchOn="viewport" prefetchRootMargin="42px">
        About
      </PrefetchNavLink>,
    );

    expect(intersection.observerFor(link)?.rootMargin).toBe("42px");

    intersection.setIntersecting(link, true);
    scheduler.flush();

    expect(chunks.calls).toEqual([ABOUT]);
  });

  it("still renders the active-state class function it was given", () => {
    // `className` must not go through `mergeProps`: on a `NavLink` it is a
    // render function, and `cn`-ing two functions would stringify their bodies.
    renderLink(
      <PrefetchNavLink to={ABOUT} className={({ isActive }) => (isActive ? "on" : "off")}>
        About
      </PrefetchNavLink>,
    );

    expect(screen.getByRole("link", { name: "About" })).toHaveClass("off");
  });

  it("does not accept React Router's inert prefetch prop", () => {
    renderLink(
      // @ts-expect-error `prefetch` is omitted on purpose: without a
      // FrameworkContext, React Router's `usePrefetchBehavior` returns
      // `[false, ref, {}]`, so the prop type-checks and does nothing. If this
      // directive ever becomes unused the prop has been let back in.
      <PrefetchNavLink to={ABOUT} prefetch="intent">
        About
      </PrefetchNavLink>,
    );

    expect(screen.getByRole("link", { name: "About" })).toBeInTheDocument();
  });
});
