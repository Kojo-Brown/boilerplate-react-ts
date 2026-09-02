import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { WebVitalsReporter } from "@/shared/analytics/WebVitalsReporter";
import { startVitalsCollection } from "@/shared/analytics/vitalsCollector";
import { createMemorySink } from "@/shared/analytics/analyticsSink";
import { makeLcpMetric } from "@/test/vitals";
import { toVitalsEvent } from "@/shared/analytics/vitalsEvent";

/**
 * The collector is mocked because jsdom implements none of the entry types the
 * real one observes, so nothing would ever be reported through it. What this
 * component is responsible for is the wiring — which sink, which sample rate,
 * which route, and tearing all of it down — and that is what is asserted here.
 * The collector's own behaviour is covered in `vitalsCollector.test.ts`.
 */
vi.mock("@/shared/analytics/vitalsCollector", () => ({
  startVitalsCollection: vi.fn(() => vi.fn()),
}));

const startCollection = vi.mocked(startVitalsCollection);

/**
 * Mounts the reporter in a layout route, the way `RootLayout` does: it has to
 * outlive the child routes, or every navigation would start a new page visit.
 */
function renderReporter(reporter: ReactNode) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <>
            {reporter}
            <Outlet />
          </>
        ),
        children: [
          { index: true, element: <Link to="/dashboard">Dashboard</Link> },
          { path: "dashboard", element: <p>On the dashboard</p> },
        ],
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  startCollection.mockClear();
});

describe("WebVitalsReporter", () => {
  it("renders nothing", () => {
    const { container } = renderReporter(<WebVitalsReporter sink={createMemorySink()} />);

    // The route's own link is all that is in the document: the reporter adds
    // no wrapper, so it can be mounted anywhere in a layout without affecting it.
    expect(container.textContent).toBe("Dashboard");
  });

  it("collects into the sink it is given", () => {
    const sink = createMemorySink();
    renderReporter(<WebVitalsReporter sink={sink} />);

    expect(startCollection).toHaveBeenCalledTimes(1);
    expect(startCollection.mock.calls[0]?.[0].sink).toBe(sink);
  });

  it("does not collect at all when reporting is disabled", () => {
    renderReporter(<WebVitalsReporter sink={null} />);

    expect(startCollection).not.toHaveBeenCalled();
  });

  it("passes the sample rate through", () => {
    renderReporter(<WebVitalsReporter sink={createMemorySink()} sampleRate={0.25} />);

    expect(startCollection.mock.calls[0]?.[0].sampleRate).toBe(0.25);
  });

  it("reports the current route, not the one the page loaded on", async () => {
    const user = userEvent.setup();
    renderReporter(<WebVitalsReporter sink={createMemorySink()} />);

    const getPath = startCollection.mock.calls[0]?.[0].getPath;
    expect(getPath?.()).toBe("/");

    await user.click(screen.getByRole("link", { name: "Dashboard" }));

    // Same collector, same closure: LCP stays attributed to "/" because it was
    // reported there, while an INP finalised after this navigation is not.
    expect(startCollection).toHaveBeenCalledTimes(1);
    expect(getPath?.()).toBe("/dashboard");
  });

  it("stops collecting when it unmounts", () => {
    const stop = vi.fn();
    startCollection.mockReturnValueOnce(stop);

    const { unmount } = renderReporter(<WebVitalsReporter sink={createMemorySink()} />);
    expect(stop).not.toHaveBeenCalled();

    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("flushes the sink when the page goes away", () => {
    const sink = createMemorySink();
    renderReporter(<WebVitalsReporter sink={sink} />);

    const event = toVitalsEvent(makeLcpMetric(), {
      path: "/",
      visitId: "visit-1",
      reportedAt: 1_000,
    });
    if (!event) throw new Error("LCP did not shape into an event");
    sink.record(event);
    expect(sink.batches).toHaveLength(0);

    // The last moment a browser reliably runs script. Without this listener the
    // batch queued at page hide is simply never sent.
    window.dispatchEvent(new Event("pagehide"));

    expect(sink.batches.map((batch) => batch.map((e) => e.metric))).toEqual([["LCP"]]);
  });

  it("stops flushing after unmount", () => {
    const sink = createMemorySink();
    const { unmount } = renderReporter(<WebVitalsReporter sink={sink} />);

    unmount();
    const event = toVitalsEvent(makeLcpMetric(), {
      path: "/",
      visitId: "visit-1",
      reportedAt: 1_000,
    });
    if (!event) throw new Error("LCP did not shape into an event");
    sink.record(event);
    window.dispatchEvent(new Event("pagehide"));

    expect(sink.batches).toHaveLength(0);
  });
});
