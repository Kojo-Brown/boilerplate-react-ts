import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { VirtualInfiniteList } from "@/shared/ui/performance/VirtualInfiniteList";
import { installIntersectionObserver, type IntersectionHarness } from "@/test/intersection";
import { resetVirtualWindow, setVirtualWindow } from "@/test/virtualizerMock";

// The real virtualizer needs a `ResizeObserver` and a layout, and jsdom has
// neither — see `src/test/virtualizerMock.ts`. Everything geometric is
// asserted in `e2e/windowed-infinite-scroll.spec.ts` instead.
vi.mock("@tanstack/react-virtual", () => import("@/test/virtualizerMock"));

let harness: IntersectionHarness;

beforeEach(() => {
  harness = installIntersectionObserver();
});

afterEach(() => {
  harness.restore();
  resetVirtualWindow();
});

interface Row {
  id: number;
  label: string;
}

const rows = (n: number, from = 0): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: from + i + 1, label: `Row ${from + i + 1}` }));

function renderList(overrides: Partial<Parameters<typeof VirtualInfiniteList<Row>>[0]> = {}) {
  const onLoadMore = vi.fn();
  const props = {
    items: rows(30),
    getItemKey: (row: Row) => row.id,
    renderItem: (row: Row) => <span>{row.label}</span>,
    hasNextPage: true,
    isFetchingNextPage: false,
    onLoadMore,
    label: "Test feed",
    ...overrides,
  };
  const result = render(<VirtualInfiniteList<Row> {...props} />);
  const rerenderWith = (next: Partial<typeof props>) => {
    result.rerender(<VirtualInfiniteList<Row> {...props} {...next} />);
  };
  return { onLoadMore, rerenderWith, ...result };
}

const sentinel = () => screen.getByTestId("prefetch-sentinel");

describe("VirtualInfiniteList rendering", () => {
  it("renders only the rows the virtualiser reports", () => {
    renderList({ items: rows(1_000) });
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
  });

  it("names the list for assistive technology", () => {
    renderList();
    expect(screen.getByRole("list", { name: "Test feed" })).toBeInTheDocument();
  });

  it("renders each item through renderItem", () => {
    renderList();
    expect(screen.getByText("Row 1")).toBeInTheDocument();
    expect(screen.getByText("Row 10")).toBeInTheDocument();
    expect(screen.queryByText("Row 11")).not.toBeInTheDocument();
  });

  it("renders the window the virtualiser moved to", () => {
    setVirtualWindow({ start: 20, size: 3 });
    renderList();
    expect(screen.getByText("Row 21")).toBeInTheDocument();
    expect(screen.queryByText("Row 1")).not.toBeInTheDocument();
  });

  it("skips indices the virtualiser reports past the end of the data", () => {
    // A transient the real virtualizer produces when `count` shrinks a render
    // before its range is recomputed.
    setVirtualWindow({ size: 3, overrun: 2 });
    renderList({ items: rows(3) });
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("sets the scroll range to the virtualiser's total size", () => {
    renderList({ items: rows(100), estimateSize: 50 });
    expect(screen.getByRole("list")).toHaveStyle({ height: "5000px" });
  });

  it("applies the container height", () => {
    renderList({ height: 640 });
    expect(screen.getByTestId("virtual-scroll-container")).toHaveStyle({ height: "640px" });
  });

  it("forwards className to the scroll container", () => {
    renderList({ className: "custom" });
    expect(screen.getByTestId("virtual-scroll-container")).toHaveClass("custom");
  });
});

describe("VirtualInfiniteList sentinel", () => {
  it("observes against the scroll container, not the viewport", () => {
    // The mistake this pins is silent: with the default root the bottom
    // `rootMargin` grows the *viewport's* box, which says nothing about how
    // close the sentinel is to the end of an inner scroller. Prefetching would
    // degrade to loading at the bottom and look identical on a fast network.
    renderList();
    const observer = harness.observerFor(sentinel());
    expect(observer?.root).toBe(screen.getByTestId("virtual-scroll-container"));
  });

  it("encodes prefetchMargin as the observer's bottom root margin", () => {
    renderList({ prefetchMargin: 600 });
    expect(harness.observerFor(sentinel())?.rootMargin).toBe("0px 0px 600px 0px");
  });

  it("defaults to a 400px margin", () => {
    renderList();
    expect(harness.observerFor(sentinel())?.rootMargin).toBe("0px 0px 400px 0px");
  });

  it("uses a zero margin when asked to load at the bottom", () => {
    renderList({ prefetchMargin: 0 });
    expect(harness.observerFor(sentinel())?.rootMargin).toBe("0px 0px 0px 0px");
  });

  it("is mounted before any scrolling has happened", () => {
    // The whole reason the sentinel sits after the spacer rather than among
    // the rows: a virtualised list does not render its last row until you have
    // scrolled to it, so a sentinel placed there could never be observed early.
    renderList({ items: rows(5_000) });
    expect(sentinel()).toBeInTheDocument();
  });

  it("is removed once there is no next page", () => {
    renderList({ hasNextPage: false });
    expect(screen.queryByTestId("prefetch-sentinel")).not.toBeInTheDocument();
    expect(harness.liveCount()).toBe(0);
  });
});

describe("VirtualInfiniteList loading", () => {
  it("asks for more when the sentinel comes into view", () => {
    const { onLoadMore } = renderList();

    harness.setIntersecting(sentinel(), true);

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not ask before the sentinel is in view", () => {
    const { onLoadMore } = renderList();
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("does not ask while a page is already in flight", () => {
    const { onLoadMore } = renderList({ isFetchingNextPage: true });

    harness.setIntersecting(sentinel(), true);

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("continues loading when a page lands and the sentinel never left view", () => {
    // The stall this component is written to survive. `IntersectionObserver`
    // reports *transitions*; a page shorter than the prefetch margin leaves the
    // sentinel exactly where it was, so no callback fires. An implementation
    // driven by the observer callback stops here and waits for a scroll that
    // the user has no reason to make — the list simply stops growing.
    const { onLoadMore, rerenderWith } = renderList();

    harness.setIntersecting(sentinel(), true);
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerenderWith({ isFetchingNextPage: true });
    rerenderWith({ isFetchingNextPage: false, items: rows(60) });

    // No second `setIntersecting`: nothing about the intersection changed.
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it("stops asking once the last page has landed", () => {
    const { onLoadMore, rerenderWith } = renderList();
    harness.setIntersecting(sentinel(), true);
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerenderWith({ isFetchingNextPage: false, hasNextPage: false, items: rows(60) });

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not ask again when the sentinel leaves view", () => {
    const { onLoadMore } = renderList();

    harness.setIntersecting(sentinel(), true);
    harness.setIntersecting(sentinel(), false);

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("survives an onLoadMore that changes identity on every render", () => {
    // The effect depends on the callback, so an inline arrow would re-run it
    // on every commit and turn one prefetch into a fetch per render.
    const spy = vi.fn();
    const items = rows(30);
    const view = render(
      <VirtualInfiniteList<Row>
        items={items}
        getItemKey={(row) => row.id}
        renderItem={(row) => <span>{row.label}</span>}
        hasNextPage
        isFetchingNextPage={false}
        onLoadMore={() => {
          spy();
        }}
        label="Test feed"
      />,
    );

    harness.setIntersecting(sentinel(), true);
    for (let i = 0; i < 3; i += 1) {
      view.rerender(
        <VirtualInfiniteList<Row>
          items={items}
          getItemKey={(row) => row.id}
          renderItem={(row) => <span>{row.label}</span>}
          hasNextPage
          isFetchingNextPage={false}
          onLoadMore={() => {
            spy();
          }}
          label="Test feed"
        />,
      );
    }

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("VirtualInfiniteList status", () => {
  it("keeps the live region mounted while it has nothing to say", () => {
    // A live region added in the same commit as its text is a region screen
    // readers were not watching when it changed.
    renderList();
    expect(screen.getByTestId("load-more-status")).toHaveTextContent("");
  });

  it("announces a page in flight", () => {
    renderList({ isFetchingNextPage: true });
    expect(screen.getByRole("status")).toHaveTextContent("Loading more…");
  });

  it("announces the end of the feed with the final count", () => {
    renderList({ hasNextPage: false, items: rows(37) });
    expect(screen.getByRole("status")).toHaveTextContent("All 37 items loaded");
  });
});
