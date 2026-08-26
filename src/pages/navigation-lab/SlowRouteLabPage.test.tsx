import { Suspense } from "react";
import { MemoryRouter } from "react-router";
import { screen, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SlowRouteLabPage, SlowRouteLabRoute } from "@/pages/navigation-lab/SlowRouteLabPage";
import { createSlowRouteCache, type SlowRouteCache } from "@/pages/navigation-lab/slowRoute";
import { RouteTransitionHarness } from "@/test/routeTransitionHarness";
import { renderAsync } from "@/test/renderSuspense";

/** A cache whose runs settle when the test says so, not on a timer. */
function gatedCache(): { cache: SlowRouteCache; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    cache: createSlowRouteCache(() => gate),
    release: () => {
      release();
    },
  };
}

function renderPage(cache: SlowRouteCache, search: string) {
  return renderAsync(
    <RouteTransitionHarness initialEntries={[`/labs/navigation/slow${search}`]}>
      <Suspense fallback={<div>WAITING</div>}>
        <SlowRouteLabPage cache={cache} />
      </Suspense>
    </RouteTransitionHarness>,
  );
}

describe("SlowRouteLabPage", () => {
  it("suspends until its run settles", async () => {
    const { cache, release } = gatedCache();
    await renderPage(cache, "?latency=600&run=1");

    expect(screen.getByText("WAITING")).toBeInTheDocument();

    release();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Slow route" })).toBeInTheDocument();
    });
  });

  it("reports the latency it was configured with", async () => {
    const { cache, release } = gatedCache();
    await renderPage(cache, "?latency=600&run=1");
    release();
    await waitFor(() => {
      expect(screen.getByText(/took 600ms to arrive/)).toBeInTheDocument();
    });
  });

  it("offers a way back to the lab", async () => {
    const { cache, release } = gatedCache();
    await renderPage(cache, "?latency=0&run=1");
    release();
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Back to the lab" })).toHaveAttribute(
        "href",
        "/labs/navigation",
      );
    });
  });
});

describe("SlowRouteLabRoute", () => {
  it("adds its own boundary for the per-route arm", async () => {
    // This is the arm that reproduces the old behaviour: a boundary at this
    // depth is new on arrival, so React commits its fallback and whatever was
    // on screen is gone.
    await renderAsync(
      <MemoryRouter initialEntries={["/labs/navigation/slow?boundary=per-route&run=1"]}>
        <SlowRouteLabRoute />
      </MemoryRouter>,
    );
    expect(screen.getByRole("status", { name: "Loading page" })).toBeInTheDocument();
  });

  it("suspends past the route element for the hoisted arm", async () => {
    // No boundary of its own, so the suspension travels up to whichever
    // boundary already exists — in the app, the one in RootLayout.
    await renderAsync(
      <MemoryRouter initialEntries={["/labs/navigation/slow?boundary=hoisted&run=1"]}>
        <Suspense fallback={<div>OUTER BOUNDARY</div>}>
          <SlowRouteLabRoute />
        </Suspense>
      </MemoryRouter>,
    );
    expect(screen.getByText("OUTER BOUNDARY")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading page" })).not.toBeInTheDocument();
  });
});
