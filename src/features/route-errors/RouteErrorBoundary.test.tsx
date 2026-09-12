import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode } from "react";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { RouteErrorBoundary, RouteErrorFallback } from "@/features/route-errors/RouteErrorBoundary";
import { ErrorReporterProvider } from "@/shared/observability/ErrorReporterProvider";
import { createMemoryTransport, createReporter } from "@/shared/observability/errorReporter";
import { RELOAD_GUARD_KEY } from "@/features/route-errors/routeErrorKind";

let consoleErrorSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  sessionStorage.clear();
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

/** A page whose failure is controlled from outside the render. */
function makePage(label: string, failing: { value: Error | null }) {
  return function Page(): ReactNode {
    if (failing.value !== null) throw failing.value;
    return <p>{label} content</p>;
  };
}

type RouteChildren = NonNullable<Parameters<typeof createMemoryRouter>[0][number]["children"]>;

function renderRoutes(
  children: RouteChildren,
  options: {
    initialEntries?: string[];
    reporterEvents?: ReturnType<typeof createMemoryTransport>;
  } = {},
) {
  const sink = options.reporterEvents ?? createMemoryTransport();
  const reporter = createReporter({ transport: sink.transport, dedupeWindowMs: 0 });
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <div>
            <nav>
              <Link to="/a">to a</Link>
              <Link to="/b">to b</Link>
            </nav>
            <Outlet />
          </div>
        ),
        children,
      },
    ],
    { initialEntries: options.initialEntries ?? ["/a"] },
  );
  const view = render(
    <ErrorReporterProvider reporter={reporter}>
      <RouterProvider router={router} />
    </ErrorReporterProvider>,
  );
  return { ...view, sink, router };
}

describe("RouteErrorBoundary blast radius", () => {
  it("keeps the layout and the siblings' navigation usable", () => {
    const failing: { value: Error | null } = { value: new Error("page A is broken") };
    const PageA = makePage("A", failing);
    renderRoutes([
      {
        path: "a",
        element: (
          <RouteErrorBoundary route="/a">
            <PageA />
          </RouteErrorBoundary>
        ),
      },
    ]);

    expect(screen.getByTestId("route-error")).toBeInTheDocument();
    // The shell is still there — this is the whole point of a per-route
    // boundary over one at the layout.
    expect(screen.getByRole("link", { name: "to b" })).toBeInTheDocument();
  });

  it("does not hold one route's error over a sibling route", async () => {
    /*
     * The bug reset keys exist to remove, and it is silent without them.
     *
     * React reconciles by position and type, so every route's boundary is the
     * *same instance* at the `<Outlet>` slot. A boundary without reset keys
     * keeps its error across the navigation, and the destination never
     * renders: the user clicks a working link, the URL changes, and they are
     * still looking at the previous page's error screen.
     */
    const user = userEvent.setup();
    const failingA: { value: Error | null } = { value: new Error("page A is broken") };
    const okB: { value: Error | null } = { value: null };
    const PageA = makePage("A", failingA);
    const PageB = makePage("B", okB);

    renderRoutes([
      {
        path: "a",
        element: (
          <RouteErrorBoundary route="/a">
            <PageA />
          </RouteErrorBoundary>
        ),
      },
      {
        path: "b",
        element: (
          <RouteErrorBoundary route="/b">
            <PageB />
          </RouteErrorBoundary>
        ),
      },
    ]);

    expect(screen.getByTestId("route-error")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "to b" }));

    expect(screen.getByText("B content")).toBeInTheDocument();
    expect(screen.queryByTestId("route-error")).not.toBeInTheDocument();
  });

  it("clears on a same-path navigation, which is what changes a query string", async () => {
    // `location.key` rather than `pathname` as the reset key: the search
    // params are often exactly what broke the page, and a pathname key would
    // leave the user stuck after they changed them.
    const user = userEvent.setup();
    const failing: { value: Error | null } = { value: new Error("bad filter") };
    const Page = makePage("A", failing);

    renderRoutes([
      {
        path: "a",
        element: (
          <RouteErrorBoundary route="/a">
            <Page />
          </RouteErrorBoundary>
        ),
      },
    ]);
    expect(screen.getByTestId("route-error")).toBeInTheDocument();

    failing.value = null;
    await user.click(screen.getByRole("link", { name: "to a" }));
    expect(screen.getByText("A content")).toBeInTheDocument();
  });
});

describe("RouteErrorBoundary retry", () => {
  it("recovers in place when the failure was transient", () => {
    const failing: { value: Error | null } = { value: new Error("transient") };
    const Page = makePage("A", failing);
    renderRoutes([
      {
        path: "a",
        element: (
          <RouteErrorBoundary route="/a">
            <Page />
          </RouteErrorBoundary>
        ),
      },
    ]);

    failing.value = null;
    fireEvent.click(screen.getByTestId("route-error-retry"));
    expect(screen.getByText("A content")).toBeInTheDocument();
  });

  it("stops offering a retry once the attempts are spent", () => {
    const failing: { value: Error | null } = { value: new Error("deterministic") };
    const Page = makePage("A", failing);
    renderRoutes([
      {
        path: "a",
        element: (
          <RouteErrorBoundary route="/a" maxRetries={2}>
            <Page />
          </RouteErrorBoundary>
        ),
      },
    ]);

    fireEvent.click(screen.getByTestId("route-error-retry"));
    expect(screen.getByTestId("route-error-retry")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("route-error-retry"));

    // A button that has visibly done nothing twice is worse than one that
    // admits it and offers something else.
    expect(screen.queryByTestId("route-error-retry")).not.toBeInTheDocument();
    expect(screen.getByTestId("route-error-reload")).toBeInTheDocument();
    expect(screen.getByText(/Retrying didn’t help/)).toBeInTheDocument();
  });

  it("gives a fresh budget of retries after a navigation", async () => {
    const user = userEvent.setup();
    const failing: { value: Error | null } = { value: new Error("deterministic") };
    const Page = makePage("A", failing);
    const okB: { value: Error | null } = { value: null };
    const PageB = makePage("B", okB);

    renderRoutes([
      {
        path: "a",
        element: (
          <RouteErrorBoundary route="/a" maxRetries={1}>
            <Page />
          </RouteErrorBoundary>
        ),
      },
      {
        path: "b",
        element: (
          <RouteErrorBoundary route="/b">
            <PageB />
          </RouteErrorBoundary>
        ),
      },
    ]);

    fireEvent.click(screen.getByTestId("route-error-retry"));
    expect(screen.queryByTestId("route-error-retry")).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "to b" }));
    await user.click(screen.getByRole("link", { name: "to a" }));

    expect(screen.getByTestId("route-error-retry")).toBeInTheDocument();
  });

  it("never offers a retry for a stale chunk, which cannot recover in place", () => {
    // `React.lazy` memoises its rejected promise, so resetting the boundary
    // re-reads it and rethrows the identical error in the same frame.
    const failing = {
      value: new TypeError("Failed to fetch dynamically imported module: /assets/A-4f21.js"),
    };
    const Page = makePage("A", failing);
    renderRoutes([
      {
        path: "a",
        element: (
          <RouteErrorBoundary route="/a">
            <Page />
          </RouteErrorBoundary>
        ),
      },
    ]);

    expect(screen.getByTestId("route-error")).toHaveAttribute("data-kind", "chunk-load");
    expect(screen.queryByTestId("route-error-retry")).not.toBeInTheDocument();
    expect(screen.getByTestId("route-error-reload")).toBeInTheDocument();
    expect(screen.getByText(/updated while this tab was open/)).toBeInTheDocument();
  });
});

describe("RouteErrorBoundary reporting", () => {
  it("reports once, tagged with the route and the error kind", () => {
    const sink = createMemoryTransport();
    const failing: { value: Error | null } = { value: new Error("page A is broken") };
    const Page = makePage("A", failing);
    renderRoutes(
      [
        {
          path: "a",
          element: (
            <RouteErrorBoundary route="/a">
              <Page />
            </RouteErrorBoundary>
          ),
        },
      ],
      { reporterEvents: sink },
    );

    expect(sink.events).toHaveLength(1);
    const event = sink.events[0];
    expect(event?.tags).toMatchObject({
      route: "/a",
      "error.kind": "render",
      "retry.attempt": "0",
    });
    expect(event?.mechanism).toEqual({ type: "route-boundary", handled: true });
    expect(event?.contexts.react?.componentStack).toContain("Page");
    expect(event?.contexts["route"]).toMatchObject({ path: "/a" });
  });

  it("records which attempt failed, not the attempt count at first render", () => {
    const sink = createMemoryTransport();
    const failing: { value: Error | null } = { value: new Error("deterministic") };
    const Page = makePage("A", failing);
    renderRoutes(
      [
        {
          path: "a",
          element: (
            <RouteErrorBoundary route="/a" maxRetries={3}>
              <Page />
            </RouteErrorBoundary>
          ),
        },
      ],
      { reporterEvents: sink },
    );

    fireEvent.click(screen.getByTestId("route-error-retry"));
    fireEvent.click(screen.getByTestId("route-error-retry"));

    expect(sink.events.map((e) => e.tags["retry.attempt"])).toEqual(["0", "1", "2"]);
  });

  it("shows the event id so a user can quote it", () => {
    const sink = createMemoryTransport();
    const failing: { value: Error | null } = { value: new Error("boom") };
    const Page = makePage("A", failing);
    renderRoutes(
      [
        {
          path: "a",
          element: (
            <RouteErrorBoundary route="/a">
              <Page />
            </RouteErrorBoundary>
          ),
        },
      ],
      { reporterEvents: sink },
    );

    expect(screen.getByTestId("route-error-event-id")).toHaveTextContent(
      sink.events[0]?.eventId.slice(0, 8) ?? "",
    );
  });

  it("omits the reference when the reporter dropped the event", () => {
    // A dropped event has no id anyone could look up, so showing one would be
    // handing the user a reference to something that was never sent.
    const reporter = createReporter({ transport: () => {}, beforeSend: () => null });
    const failing: { value: Error | null } = { value: new Error("boom") };
    const Page = makePage("A", failing);
    const router = createMemoryRouter(
      [
        {
          path: "/a",
          element: (
            <RouteErrorBoundary route="/a">
              <Page />
            </RouteErrorBoundary>
          ),
        },
      ],
      { initialEntries: ["/a"] },
    );
    render(
      <ErrorReporterProvider reporter={reporter}>
        <RouterProvider router={router} />
      </ErrorReporterProvider>,
    );

    expect(screen.getByTestId("route-error")).toBeInTheDocument();
    expect(screen.queryByTestId("route-error-event-id")).not.toBeInTheDocument();
  });

  it("reports a thrown non-Error without crashing the fallback", () => {
    const sink = createMemoryTransport();
    function ThrowsAString(): ReactNode {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "just a string";
    }
    const router = createMemoryRouter(
      [
        {
          path: "/a",
          element: (
            <RouteErrorBoundary route="/a">
              <ThrowsAString />
            </RouteErrorBoundary>
          ),
        },
      ],
      { initialEntries: ["/a"] },
    );
    render(
      <ErrorReporterProvider reporter={createReporter({ transport: sink.transport })}>
        <RouterProvider router={router} />
      </ErrorReporterProvider>,
    );

    expect(screen.getByTestId("route-error")).toBeInTheDocument();
    expect(sink.events[0]?.exception[0]?.value).toBe("just a string");
  });
});

describe("RouteErrorFallback", () => {
  it("reloads the document when asked", () => {
    const reload = vi.fn();
    render(
      <RouteErrorFallback
        route="/a"
        message="broken"
        kind="chunk-load"
        eventId={null}
        attempt={0}
        maxRetries={2}
        onRetry={vi.fn()}
        reload={reload}
      />,
    );
    fireEvent.click(screen.getByTestId("route-error-reload"));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("refuses a second reload and says why, rather than looping the tab", () => {
    const reload = vi.fn();
    const view = (
      <RouteErrorFallback
        route="/a"
        message="broken"
        kind="chunk-load"
        eventId={null}
        attempt={0}
        maxRetries={2}
        onRetry={vi.fn()}
        reload={reload}
      />
    );
    const { unmount } = render(view);
    fireEvent.click(screen.getByTestId("route-error-reload"));
    expect(reload).toHaveBeenCalledOnce();
    unmount();

    // A real reload would remount the app; this stands in for the fresh
    // document failing the same import again.
    render(view);
    fireEvent.click(screen.getByTestId("route-error-reload"));

    expect(reload).toHaveBeenCalledOnce();
    expect(screen.getByTestId("reload-blocked")).toBeInTheDocument();
    expect(sessionStorage.getItem(RELOAD_GUARD_KEY)).not.toBeNull();
  });

  it("falls back to generic copy for an error with no message", () => {
    render(
      <RouteErrorFallback
        route="/a"
        message=""
        kind="render"
        eventId={null}
        attempt={0}
        maxRetries={2}
        onRetry={vi.fn()}
        reload={vi.fn()}
      />,
    );
    expect(screen.getByText("An unexpected error occurred.")).toBeInTheDocument();
  });

  it("is announced to assistive technology", () => {
    render(
      <RouteErrorFallback
        route="/a"
        message="broken"
        kind="render"
        eventId={null}
        attempt={0}
        maxRetries={2}
        onRetry={vi.fn()}
        reload={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
