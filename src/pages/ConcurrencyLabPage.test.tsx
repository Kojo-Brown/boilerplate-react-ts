import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ConcurrencyLabPage } from "./ConcurrencyLabPage";
import type { FrameStats } from "@/lib/jankMeter";

/**
 * Frame callbacks are queued rather than fired, so a test decides exactly which
 * timestamps the jank meter observes.
 */
function stubFrameScheduler() {
  const queue: ((timestamp: number) => void)[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: (timestamp: number) => void) => {
    queue.push(callback);
    return queue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});

  return function emitFrames(timestamps: readonly number[]): void {
    for (const timestamp of timestamps) {
      queue.shift()?.(timestamp);
    }
  };
}

function renderLab(search = "?n=20") {
  const router = createMemoryRouter(
    [{ path: "/labs/concurrency", element: <ConcurrencyLabPage /> }],
    {
      initialEntries: [`/labs/concurrency${search}`],
    },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

function readStats(): FrameStats {
  const raw = screen.getByTestId("frame-stats").getAttribute("data-stats");
  return JSON.parse(raw ?? "{}") as FrameStats;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ConcurrencyLabPage", () => {
  it("renders the lab heading", () => {
    renderLab();
    expect(screen.getByRole("heading", { name: "Concurrency Lab" })).toBeInTheDocument();
  });

  it("builds the dataset from the n search param", () => {
    renderLab("?n=12");
    expect(screen.getByTestId("result-count")).toHaveTextContent("12 of 12 matches");
  });

  it("states the dataset size in the description", () => {
    renderLab("?n=1200");
    expect(screen.getByText(/1,200 rows/)).toBeInTheDocument();
  });

  it("defaults to concurrent mode", () => {
    renderLab();
    expect(screen.getByTestId("concurrent-filter-list")).toHaveAttribute("data-mode", "concurrent");
    expect(screen.getByRole("button", { name: "Concurrent" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("reads blocking mode from the URL", () => {
    renderLab("?n=20&mode=blocking");
    expect(screen.getByTestId("concurrent-filter-list")).toHaveAttribute("data-mode", "blocking");
    expect(screen.getByRole("button", { name: "Blocking" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("treats an unknown mode as concurrent", () => {
    renderLab("?n=20&mode=nonsense");
    expect(screen.getByTestId("concurrent-filter-list")).toHaveAttribute("data-mode", "concurrent");
  });

  it("writes the selected mode back to the URL", async () => {
    const user = userEvent.setup();
    const { router } = renderLab();

    await user.click(screen.getByRole("button", { name: "Blocking" }));

    expect(screen.getByTestId("concurrent-filter-list")).toHaveAttribute("data-mode", "blocking");
    expect(router.state.location.search).toContain("mode=blocking");
  });

  it("preserves the dataset size when the mode changes", async () => {
    const user = userEvent.setup();
    const { router } = renderLab("?n=12");

    await user.click(screen.getByRole("button", { name: "Blocking" }));

    expect(router.state.location.search).toContain("n=12");
    expect(screen.getByTestId("result-count")).toHaveTextContent("12 of 12 matches");
  });

  it("shows the empty-state hint before any recording", () => {
    renderLab();
    expect(screen.getByTestId("frame-stats-empty")).toBeInTheDocument();
    expect(screen.getByTestId("recording-state")).toHaveTextContent("Idle");
  });

  it("reports frame stats once a recording is stopped", async () => {
    const emitFrames = stubFrameScheduler();
    const user = userEvent.setup();
    renderLab();

    await user.click(screen.getByTestId("record-toggle"));
    expect(screen.getByTestId("recording-state")).toHaveTextContent("Recording…");

    // 16ms, 16ms, then a 300ms stall — one dropped frame out of three.
    emitFrames([0, 16, 32, 332]);
    await user.click(screen.getByTestId("record-toggle"));

    const stats = readStats();
    expect(stats.frames).toBe(3);
    expect(stats.longestFrameMs).toBe(300);
    expect(stats.droppedFrames).toBe(1);
    expect(screen.getByTestId("recording-state")).toHaveTextContent("Idle");
  });

  it("renders the recorded numbers", async () => {
    const emitFrames = stubFrameScheduler();
    const user = userEvent.setup();
    renderLab();

    await user.click(screen.getByTestId("record-toggle"));
    emitFrames([0, 16, 32, 332]);
    await user.click(screen.getByTestId("record-toggle"));

    expect(screen.getByTestId("stat-longest-frame")).toHaveTextContent("300.0 ms");
    expect(screen.getByTestId("stat-dropped-frames")).toHaveTextContent("1 / 3");
    expect(screen.getByTestId("stat-fps")).toHaveTextContent("9.0");
  });

  it("discards stats when the mode changes, since the arms are not comparable", async () => {
    const emitFrames = stubFrameScheduler();
    const user = userEvent.setup();
    renderLab();

    await user.click(screen.getByTestId("record-toggle"));
    emitFrames([0, 16, 332]);
    await user.click(screen.getByTestId("record-toggle"));
    expect(screen.getByTestId("frame-stats")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Blocking" }));

    expect(screen.queryByTestId("frame-stats")).not.toBeInTheDocument();
    expect(screen.getByTestId("frame-stats-empty")).toBeInTheDocument();
  });

  it("starts a fresh recording rather than resuming the previous one", async () => {
    const emitFrames = stubFrameScheduler();
    const user = userEvent.setup();
    renderLab();

    await user.click(screen.getByTestId("record-toggle"));
    emitFrames([0, 500]);
    await user.click(screen.getByTestId("record-toggle"));
    expect(readStats().longestFrameMs).toBe(500);

    await user.click(screen.getByTestId("record-toggle"));
    emitFrames([1000, 1016, 1032]);
    await user.click(screen.getByTestId("record-toggle"));

    const stats = readStats();
    expect(stats.frames).toBe(2);
    expect(stats.longestFrameMs).toBe(16);
  });
});
