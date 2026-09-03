import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { RoutePrefetchProvider } from "@/features/route-prefetch/routePrefetch";
import {
  usePrefetchTriggers,
  DEFAULT_HOVER_DELAY_MS,
  DEFAULT_ROOT_MARGIN,
  type PrefetchTrigger,
} from "@/features/route-prefetch/usePrefetchTriggers";
import {
  createManualIdleScheduler,
  createStubChunkRegistry,
  type ManualIdleScheduler,
  type StubChunkRegistry,
} from "@/test/prefetch";
import { installIntersectionObserver, type IntersectionHarness } from "@/test";

const ABOUT = "/about";

function TriggerLink({ trigger }: { trigger: PrefetchTrigger }) {
  const triggers = usePrefetchTriggers({ href: ABOUT, trigger });
  return (
    <a href={ABOUT} {...triggers}>
      About
    </a>
  );
}

interface Harness {
  readonly scheduler: ManualIdleScheduler;
  readonly chunks: StubChunkRegistry;
  readonly link: HTMLElement;
}

function renderTrigger(trigger: PrefetchTrigger = "hover"): Harness {
  const scheduler = createManualIdleScheduler();
  const chunks = createStubChunkRegistry([ABOUT]);

  render(
    <RoutePrefetchProvider registry={chunks.registry} scheduler={scheduler}>
      <TriggerLink trigger={trigger} />
    </RoutePrefetchProvider>,
  );

  return { scheduler, chunks, link: screen.getByRole("link", { name: "About" }) };
}

/** Let the dwell timer elapse, then let the browser go idle. */
function dwellAndIdle(scheduler: ManualIdleScheduler, ms = DEFAULT_HOVER_DELAY_MS): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  scheduler.flush();
}

describe("usePrefetchTriggers", () => {
  let intersection: IntersectionHarness;

  beforeEach(() => {
    vi.useFakeTimers();
    intersection = installIntersectionObserver();
  });

  afterEach(() => {
    vi.useRealTimers();
    intersection.restore();
  });

  describe("hover", () => {
    it("waits out the dwell before asking for anything", () => {
      const { scheduler, chunks, link } = renderTrigger();

      fireEvent.pointerEnter(link);
      act(() => {
        vi.advanceTimersByTime(DEFAULT_HOVER_DELAY_MS - 1);
      });
      scheduler.flush();
      expect(chunks.calls).toEqual([]);

      dwellAndIdle(scheduler, 1);
      expect(chunks.calls).toEqual([ABOUT]);
    });

    it("asks for nothing when the pointer passes straight over", () => {
      // The whole reason for the dwell: a pointer crossing a nav bar enters
      // and leaves every item in it, and at zero delay that is one chunk
      // request per link it happened to touch.
      const { scheduler, chunks, link } = renderTrigger();

      fireEvent.pointerEnter(link);
      act(() => {
        vi.advanceTimersByTime(DEFAULT_HOVER_DELAY_MS / 2);
      });
      fireEvent.pointerLeave(link);

      dwellAndIdle(scheduler);
      expect(chunks.calls).toEqual([]);
    });

    it("withdraws a queued request when the pointer leaves before the browser is idle", () => {
      const { scheduler, chunks, link } = renderTrigger();

      fireEvent.pointerEnter(link);
      act(() => {
        vi.advanceTimersByTime(DEFAULT_HOVER_DELAY_MS);
      });
      // Queued but not dispatched: the browser has not gone idle yet.
      expect(chunks.calls).toEqual([]);

      fireEvent.pointerLeave(link);
      scheduler.flush();

      expect(chunks.calls).toEqual([]);
    });

    it("cannot recall a load that has already started", () => {
      const { scheduler, chunks, link } = renderTrigger();

      fireEvent.pointerEnter(link);
      dwellAndIdle(scheduler);
      expect(chunks.calls).toEqual([ABOUT]);

      fireEvent.pointerLeave(link);

      // The bytes are on the wire; there is no abort signal on `import()`.
      expect(chunks.calls).toEqual([ABOUT]);
    });

    it("requests immediately on focus, with no dwell", () => {
      // A keyboard user who has tabbed to a link is at it. There is no hover
      // to measure and nothing to disambiguate.
      const { scheduler, chunks, link } = renderTrigger();

      fireEvent.focus(link);
      scheduler.flush();

      expect(chunks.calls).toEqual([ABOUT]);
    });

    it("requests immediately on touch", () => {
      // Touch produces no hover at all: the pointer events fire as part of the
      // tap, a few milliseconds ahead of the click, so a dwell would spend the
      // entire window it had.
      const { scheduler, chunks, link } = renderTrigger();

      fireEvent.touchStart(link);
      scheduler.flush();

      expect(chunks.calls).toEqual([ABOUT]);
    });

    it("constructs no IntersectionObserver", () => {
      // A nav of hover links should not put an observer on every item.
      renderTrigger("hover");
      expect(intersection.observers).toHaveLength(0);
    });

    it("drops a pending dwell when the link unmounts", () => {
      const scheduler = createManualIdleScheduler();
      const chunks = createStubChunkRegistry([ABOUT]);
      const { unmount } = render(
        <RoutePrefetchProvider registry={chunks.registry} scheduler={scheduler}>
          <TriggerLink trigger="hover" />
        </RoutePrefetchProvider>,
      );

      fireEvent.pointerEnter(screen.getByRole("link", { name: "About" }));
      unmount();
      act(() => {
        vi.advanceTimersByTime(DEFAULT_HOVER_DELAY_MS * 4);
      });
      scheduler.flush();

      expect(chunks.calls).toEqual([]);
    });
  });

  describe("viewport", () => {
    it("observes the anchor against the viewport with a lead margin", () => {
      const { link } = renderTrigger("viewport");
      const observer = intersection.observerFor(link);

      expect(observer).toBeDefined();
      // Root `null` is correct here and is not interchangeable with a
      // container: the margin has to grow the viewport's box, because the
      // viewport is what the link is approaching.
      expect(observer?.root).toBeNull();
      expect(observer?.rootMargin).toBe(DEFAULT_ROOT_MARGIN);
    });

    it("requests when the link comes into view, without being touched", () => {
      const { scheduler, chunks, link } = renderTrigger("viewport");

      intersection.setIntersecting(link, true);
      scheduler.flush();

      expect(chunks.calls).toEqual([ABOUT]);
    });

    it("ignores hover", () => {
      const { scheduler, chunks, link } = renderTrigger("viewport");

      fireEvent.pointerEnter(link);
      fireEvent.focus(link);
      dwellAndIdle(scheduler);

      expect(chunks.calls).toEqual([]);
    });

    it("disconnects the observer on unmount", () => {
      const scheduler = createManualIdleScheduler();
      const chunks = createStubChunkRegistry([ABOUT]);
      const { unmount } = render(
        <RoutePrefetchProvider registry={chunks.registry} scheduler={scheduler}>
          <TriggerLink trigger="viewport" />
        </RoutePrefetchProvider>,
      );

      expect(intersection.liveCount()).toBe(1);
      unmount();
      expect(intersection.liveCount()).toBe(0);
    });
  });

  describe("both", () => {
    it("takes either signal", () => {
      const { scheduler, chunks, link } = renderTrigger("both");

      intersection.setIntersecting(link, true);
      scheduler.flush();
      expect(chunks.calls).toEqual([ABOUT]);
    });

    it("still observes as well as listening", () => {
      const { link } = renderTrigger("both");
      expect(intersection.observerFor(link)).toBeDefined();
    });
  });

  describe("none", () => {
    it("asks for nothing and observes nothing", () => {
      const { scheduler, chunks, link } = renderTrigger("none");

      fireEvent.pointerEnter(link);
      fireEvent.focus(link);
      fireEvent.touchStart(link);
      dwellAndIdle(scheduler);

      expect(chunks.calls).toEqual([]);
      expect(intersection.observers).toHaveLength(0);
    });
  });
});
