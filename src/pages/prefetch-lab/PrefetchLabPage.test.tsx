import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { RouteTransitionHarness } from "@/test/routeTransitionHarness";
import { PrefetchLabPage } from "@/pages/prefetch-lab/PrefetchLabPage";
import { ROUTES } from "@/shared/routes/paths";
import { DEFAULT_HOVER_DELAY_MS } from "@/features/route-prefetch/usePrefetchTriggers";
import {
  createManualIdleScheduler,
  createStubChunkRegistry,
  type ManualIdleScheduler,
  type StubChunkRegistry,
} from "@/test/prefetch";
import { installIntersectionObserver, type IntersectionHarness } from "@/test";

const LAB_ROUTES = [
  ROUTES.HEADLESS_LAB,
  ROUTES.POLYMORPHIC_LAB,
  ROUTES.CHECKOUT_LAB,
  ROUTES.WORKER_LAB,
];

interface Harness {
  readonly scheduler: ManualIdleScheduler;
  readonly chunks: StubChunkRegistry;
}

function renderLab(): Harness {
  const scheduler = createManualIdleScheduler();
  const chunks = createStubChunkRegistry(LAB_ROUTES);

  render(
    <RouteTransitionHarness prefetchRegistry={chunks.registry} prefetchScheduler={scheduler}>
      <PrefetchLabPage />
    </RouteTransitionHarness>,
  );

  return { scheduler, chunks };
}

function column(name: string): HTMLElement {
  return screen.getByTestId(`queue-${name}`);
}

describe("PrefetchLabPage", () => {
  let intersection: IntersectionHarness;

  beforeEach(() => {
    vi.useFakeTimers();
    intersection = installIntersectionObserver();
  });

  afterEach(() => {
    vi.useRealTimers();
    intersection.restore();
  });

  it("starts with every queue column empty", () => {
    renderLab();

    expect(column("queued")).toHaveAttribute("data-count", "0");
    expect(column("loading")).toHaveAttribute("data-count", "0");
    expect(column("loaded")).toHaveAttribute("data-count", "0");
  });

  it("renders one hover link per lab target plus the viewport link", () => {
    renderLab();

    expect(screen.getByRole("link", { name: "Headless lab" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Polymorphic lab" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Checkout lab" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Worker lab" })).toBeInTheDocument();
  });

  it("shows a hovered route move through queued, loading and loaded", async () => {
    const { scheduler, chunks } = renderLab();
    const link = screen.getByRole("link", { name: "Headless lab" });

    fireEvent.pointerEnter(link);
    act(() => {
      vi.advanceTimersByTime(DEFAULT_HOVER_DELAY_MS);
    });

    expect(column("queued")).toHaveTextContent(ROUTES.HEADLESS_LAB);

    scheduler.flush();
    expect(column("queued")).toHaveAttribute("data-count", "0");
    expect(column("loading")).toHaveTextContent(ROUTES.HEADLESS_LAB);

    await chunks.resolve(ROUTES.HEADLESS_LAB);
    expect(column("loaded")).toHaveTextContent(ROUTES.HEADLESS_LAB);
  });

  it("queues nothing for a pointer that sweeps across the hover links", () => {
    const { scheduler } = renderLab();

    for (const name of ["Headless lab", "Polymorphic lab", "Checkout lab"]) {
      const link = screen.getByRole("link", { name });
      fireEvent.pointerEnter(link);
      act(() => {
        vi.advanceTimersByTime(DEFAULT_HOVER_DELAY_MS / 3);
      });
      fireEvent.pointerLeave(link);
    }

    act(() => {
      vi.advanceTimersByTime(DEFAULT_HOVER_DELAY_MS * 2);
    });
    scheduler.flush();

    expect(column("queued")).toHaveAttribute("data-count", "0");
    expect(column("loading")).toHaveAttribute("data-count", "0");
  });

  it("observes only the viewport link", () => {
    renderLab();

    // The three hover links must not each carry an observer.
    expect(intersection.observers).toHaveLength(1);
    expect(
      intersection.observerFor(screen.getByRole("link", { name: "Worker lab" })),
    ).toBeDefined();
  });

  it("queues the viewport link once it comes into view, untouched", () => {
    const { scheduler, chunks } = renderLab();

    intersection.setIntersecting(screen.getByRole("link", { name: "Worker lab" }), true);
    scheduler.flush();

    expect(chunks.calls).toEqual([ROUTES.WORKER_LAB]);
  });
});
