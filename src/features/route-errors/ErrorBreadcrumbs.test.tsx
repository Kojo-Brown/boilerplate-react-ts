import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { ErrorBreadcrumbs } from "@/features/route-errors/ErrorBreadcrumbs";
import { ErrorReporterProvider } from "@/shared/observability/ErrorReporterProvider";
import { createMemoryTransport, createReporter } from "@/shared/observability/errorReporter";
import { createBreadcrumbBuffer } from "@/shared/observability/breadcrumbs";

function setup(options: { trackClicks?: boolean; initialEntries?: string[] } = {}) {
  const sink = createMemoryTransport();
  const reporter = createReporter({
    transport: sink.transport,
    breadcrumbs: createBreadcrumbBuffer({ now: () => 0 }),
  });

  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <div>
            <ErrorBreadcrumbs {...(options.trackClicks === false ? { trackClicks: false } : {})} />
            <nav>
              <Link to="/a">Go to A</Link>
              <Link to="/b?token=super-secret">Go to B</Link>
            </nav>
            <Outlet />
          </div>
        ),
        children: [
          { path: "a", element: <button type="button">Refresh data</button> },
          { path: "b", element: <p>B</p> },
          { index: true, element: <p>home</p> },
        ],
      },
    ],
    { initialEntries: options.initialEntries ?? ["/"] },
  );

  const view = render(
    <ErrorReporterProvider reporter={reporter}>
      <RouterProvider router={router} />
    </ErrorReporterProvider>,
  );

  /** The trail attached to an error captured now. */
  const trail = (): string[] => {
    reporter.captureException(new Error("probe"), { mechanism: { type: "probe", handled: true } });
    const event = sink.events[sink.events.length - 1];
    return event?.breadcrumbs.map((c) => `${c.category}|${c.message}`) ?? [];
  };

  return { ...view, trail };
}

describe("ErrorBreadcrumbs", () => {
  it("renders nothing", () => {
    const { container } = render(
      <ErrorReporterProvider reporter={createReporter({ transport: () => {} })}>
        <RouterProvider
          router={createMemoryRouter([{ path: "/", element: <ErrorBreadcrumbs /> }], {
            initialEntries: ["/"],
          })}
        />
      </ErrorReporterProvider>,
    );
    expect(container.textContent).toBe("");
  });

  it("records a navigation once the user moves", async () => {
    const user = userEvent.setup();
    const { trail } = setup();
    await user.click(screen.getByRole("link", { name: "Go to A" }));
    expect(trail()).toContain("navigation|/ → /a");
  });

  it("does not record the first render as a navigation", () => {
    // A `null → /` crumb at the head of every trail is one nobody can act on.
    const { trail } = setup();
    expect(trail().filter((c) => c.startsWith("navigation"))).toEqual([]);
  });

  it("redacts a credential in the destination", async () => {
    const user = userEvent.setup();
    const { trail } = setup();
    await user.click(screen.getByRole("link", { name: "Go to B" }));
    expect(trail().join("\n")).not.toContain("super-secret");
  });

  it("records a click by the control's label", async () => {
    const user = userEvent.setup();
    const { trail } = setup({ initialEntries: ["/a"] });
    await user.click(screen.getByRole("button", { name: "Refresh data" }));
    expect(trail()).toContain("ui.click|button: Refresh data");
  });

  it("attributes a click on an inner node to the control around it", async () => {
    const user = userEvent.setup();
    const sink = createMemoryTransport();
    const reporter = createReporter({
      transport: sink.transport,
      breadcrumbs: createBreadcrumbBuffer({ now: () => 0 }),
    });
    render(
      <ErrorReporterProvider reporter={reporter}>
        <RouterProvider
          router={createMemoryRouter(
            [
              {
                path: "/",
                element: (
                  <div>
                    <ErrorBreadcrumbs />
                    <button type="button" aria-label="Save document">
                      <span data-testid="icon">💾</span>
                    </button>
                  </div>
                ),
              },
            ],
            { initialEntries: ["/"] },
          )}
        />
      </ErrorReporterProvider>,
    );

    await user.click(screen.getByTestId("icon"));
    reporter.captureException(new Error("probe"));
    expect(sink.events[0]?.breadcrumbs.map((c) => c.message)).toEqual(["button: Save document"]);
  });

  it("records a click a handler stopped from propagating", async () => {
    // Why the listener is registered in the capture phase: menus and dialogs
    // call `stopPropagation()` routinely, and a bubbling listener would lose
    // exactly the interactions most worth having in a trail.
    const user = userEvent.setup();
    const sink = createMemoryTransport();
    const reporter = createReporter({
      transport: sink.transport,
      breadcrumbs: createBreadcrumbBuffer({ now: () => 0 }),
    });
    render(
      <ErrorReporterProvider reporter={reporter}>
        <RouterProvider
          router={createMemoryRouter(
            [
              {
                path: "/",
                element: (
                  <div>
                    <ErrorBreadcrumbs />
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                      }}
                    >
                      Swallows the event
                    </button>
                  </div>
                ),
              },
            ],
            { initialEntries: ["/"] },
          )}
        />
      </ErrorReporterProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Swallows the event" }));
    reporter.captureException(new Error("probe"));
    expect(sink.events[0]?.breadcrumbs.map((c) => c.message)).toEqual([
      "button: Swallows the event",
    ]);
  });

  it("records nothing for clicks when tracking is off", async () => {
    const user = userEvent.setup();
    const { trail } = setup({ trackClicks: false, initialEntries: ["/a"] });
    await user.click(screen.getByRole("button", { name: "Refresh data" }));
    expect(trail().filter((c) => c.startsWith("ui.click"))).toEqual([]);
  });

  it("removes its listener on unmount", async () => {
    const user = userEvent.setup();
    const sink = createMemoryTransport();
    const reporter = createReporter({
      transport: sink.transport,
      breadcrumbs: createBreadcrumbBuffer({ now: () => 0 }),
    });
    const { unmount } = render(
      <ErrorReporterProvider reporter={reporter}>
        <RouterProvider
          router={createMemoryRouter([{ path: "/", element: <ErrorBreadcrumbs /> }], {
            initialEntries: ["/"],
          })}
        />
      </ErrorReporterProvider>,
    );

    unmount();
    const orphan = document.createElement("button");
    orphan.textContent = "after unmount";
    document.body.appendChild(orphan);
    await user.click(orphan);
    orphan.remove();

    reporter.captureException(new Error("probe"));
    expect(sink.events[0]?.breadcrumbs).toEqual([]);
  });

  it("keeps the trail across route changes rather than starting each page empty", async () => {
    const user = userEvent.setup();
    const { trail } = setup({ initialEntries: ["/a"] });
    await user.click(screen.getByRole("button", { name: "Refresh data" }));
    await user.click(screen.getByRole("link", { name: "Go to B" }));

    const crumbs = trail();
    expect(crumbs[0]).toBe("ui.click|button: Refresh data");
    expect(crumbs.some((c) => c.startsWith("navigation|/a → /b"))).toBe(true);
  });
});
