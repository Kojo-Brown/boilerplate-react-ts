import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { createElement, Fragment, useState } from "react";
import { useIntersection, type UseIntersectionOptions } from "@/shared/hooks/useIntersection";
import { installIntersectionObserver, type IntersectionHarness } from "@/test/intersection";

let harness: IntersectionHarness;

beforeEach(() => {
  harness = installIntersectionObserver();
});

afterEach(() => {
  harness.restore();
});

/**
 * A probe that renders its sentinel only when told to.
 *
 * Written with `createElement` rather than JSX so this file can stay a `.ts` —
 * it is a hook test, and the component is a fixture rather than a subject.
 */
function Probe({ show = true, ...options }: UseIntersectionOptions & { show?: boolean }) {
  const { ref, isIntersecting } = useIntersection<HTMLDivElement>(options);
  return createElement(
    Fragment,
    null,
    createElement("span", { "data-testid": "state" }, String(isIntersecting)),
    show ? createElement("div", { "data-testid": "sentinel", ref }) : null,
  );
}

function state() {
  return screen.getByTestId("state").textContent;
}

describe("useIntersection", () => {
  it("observes the element once it is attached", () => {
    render(createElement(Probe));

    const sentinel = screen.getByTestId("sentinel");
    expect(harness.observerFor(sentinel)).toBeDefined();
  });

  it("attaches to an element that only appears on a later render", () => {
    // The regression this hook exists for. An implementation holding the node
    // in a `useRef` sees `null` in its first (and only) effect, and because a
    // ref assignment schedules nothing there is never a second one: the
    // observer is never created and the page silently never prefetches.
    const { rerender } = render(createElement(Probe, { show: false }));
    expect(harness.observers).toHaveLength(0);

    rerender(createElement(Probe, { show: true }));

    const sentinel = screen.getByTestId("sentinel");
    expect(harness.observerFor(sentinel)).toBeDefined();
  });

  it("starts as not intersecting", () => {
    render(createElement(Probe));
    expect(state()).toBe("false");
  });

  it("reports what the observer says", () => {
    render(createElement(Probe));
    const sentinel = screen.getByTestId("sentinel");

    harness.setIntersecting(sentinel, true);
    expect(state()).toBe("true");

    harness.setIntersecting(sentinel, false);
    expect(state()).toBe("false");
  });

  it("reads the last entry when a callback carries several", () => {
    render(createElement(Probe));
    const sentinel = screen.getByTestId("sentinel");

    harness.deliverEntries(sentinel, [true, false, true]);

    expect(state()).toBe("true");
  });

  it("forwards root, rootMargin and threshold to the observer", () => {
    const root = document.createElement("div");
    render(
      createElement(Probe, { root, rootMargin: "0px 0px 600px 0px", threshold: 0.5 }),
      // The root is a detached element; nothing here measures against it.
    );

    const observer = harness.observerFor(screen.getByTestId("sentinel"));
    expect(observer?.root).toBe(root);
    expect(observer?.rootMargin).toBe("0px 0px 600px 0px");
    expect(observer?.threshold).toEqual([0.5]);
  });

  it("defaults to the viewport with a zero margin", () => {
    render(createElement(Probe));

    const observer = harness.observerFor(screen.getByTestId("sentinel"));
    expect(observer?.root).toBeNull();
    expect(observer?.rootMargin).toBe("0px");
    expect(observer?.threshold).toEqual([0]);
  });

  it("replaces the observer when an option changes", () => {
    const { rerender } = render(createElement(Probe, { rootMargin: "0px" }));
    expect(harness.liveCount()).toBe(1);

    rerender(createElement(Probe, { rootMargin: "0px 0px 600px 0px" }));

    // Replaced, not added to: the previous one is disconnected first.
    expect(harness.liveCount()).toBe(1);
    expect(harness.observers).toHaveLength(2);
    expect(harness.observers[1]?.rootMargin).toBe("0px 0px 600px 0px");
  });

  it("keeps one observer across renders that change nothing", () => {
    const { rerender } = render(createElement(Probe));
    rerender(createElement(Probe));
    rerender(createElement(Probe));

    expect(harness.observers).toHaveLength(1);
  });

  it("disconnects when the element is removed and resets the reading", () => {
    const { rerender } = render(createElement(Probe));
    const sentinel = screen.getByTestId("sentinel");
    harness.setIntersecting(sentinel, true);
    expect(state()).toBe("true");

    rerender(createElement(Probe, { show: false }));

    expect(harness.liveCount()).toBe(0);
    // Left at `true`, the caller would keep fetching against an element that
    // no longer exists.
    expect(state()).toBe("false");
  });

  it("disconnects on unmount", () => {
    const { unmount } = render(createElement(Probe));
    expect(harness.liveCount()).toBe(1);

    unmount();

    expect(harness.liveCount()).toBe(0);
  });

  it("re-observes when the same element is remounted", () => {
    const { rerender } = render(createElement(Probe));
    rerender(createElement(Probe, { show: false }));
    rerender(createElement(Probe, { show: true }));

    expect(harness.liveCount()).toBe(1);
    expect(harness.observerFor(screen.getByTestId("sentinel"))).toBeDefined();
  });

  it("keeps separate readings for separate consumers", () => {
    function Two() {
      const first = useIntersection<HTMLDivElement>();
      const second = useIntersection<HTMLDivElement>();
      return createElement(
        Fragment,
        null,
        createElement("div", { "data-testid": "a", ref: first.ref }),
        createElement("div", { "data-testid": "b", ref: second.ref }),
        createElement(
          "span",
          { "data-testid": "state" },
          `${first.isIntersecting}/${second.isIntersecting}`,
        ),
      );
    }
    render(createElement(Two));

    harness.setIntersecting(screen.getByTestId("a"), true);

    expect(state()).toBe("true/false");
  });

  it("hands back a ref that does not change identity", () => {
    const seen: ((node: HTMLDivElement | null) => void)[] = [];
    function Capture() {
      const { ref } = useIntersection<HTMLDivElement>();
      seen.push(ref);
      const [, force] = useState(0);
      return createElement("button", {
        "data-testid": "force",
        onClick: () => {
          force((n) => n + 1);
        },
        ref,
      });
    }
    render(createElement(Capture));

    act(() => {
      screen.getByTestId("force").click();
    });

    // An unstable ref would detach and re-attach the element on every render,
    // tearing the observer down and building it back up each time.
    expect(new Set(seen).size).toBe(1);
    expect(harness.observers).toHaveLength(1);
  });
});
