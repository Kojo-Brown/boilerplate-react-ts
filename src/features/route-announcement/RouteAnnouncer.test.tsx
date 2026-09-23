import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { RouteAnnouncer } from "@/features/route-announcement/RouteAnnouncer";
import { MAIN_CONTENT_ID } from "@/shared/ui/SkipLink";
import { APP_NAME } from "@/shared/config/app";

/**
 * A two-page shell with the announcer above the outlet, which is where the app
 * puts it. The `<main>` is the real one's stand-in: same id, same `tabIndex`.
 */
function Shell() {
  return (
    <div>
      <RouteAnnouncer />
      <Link to="/about">to about</Link>
      <Link to="/">to home</Link>
      <Link to="/untitled">to untitled</Link>
      <main id={MAIN_CONTENT_ID} tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

function renderApp(initialEntries = ["/"]) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <Shell />,
        children: [
          { index: true, handle: { title: "Home" }, element: <h1>Home</h1> },
          { path: "about", handle: { title: "About" }, element: <h1>About</h1> },
          { path: "untitled", element: <h1>Untitled</h1> },
        ],
      },
    ],
    { initialEntries },
  );
  return render(<RouterProvider router={router} />);
}

const announcer = () => screen.getByTestId("route-announcer");
/** The two alternating live regions, in DOM order. */
const regions = () => screen.getAllByRole("status");

beforeEach(() => {
  document.title = "";
});

describe("RouteAnnouncer", () => {
  it("renders two empty polite live regions before any navigation", () => {
    renderApp();
    // Mounted and empty from the first paint: a live region is only announced
    // when its contents change while it is already in the document.
    expect(regions()).toHaveLength(2);
    for (const region of regions()) {
      expect(region).toHaveAttribute("aria-live", "polite");
      expect(region).toHaveTextContent("");
    }
  });

  it("says nothing on the initial load, which is not a navigation", () => {
    // The screen reader announces a document load by itself; saying it again
    // talks over it.
    renderApp(["/about"]);
    expect(announcer()).toHaveTextContent("");
  });

  it("announces the page that arrived", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("link", { name: "to about" }));
    expect(announcer()).toHaveTextContent("About, page loaded");
  });

  it("announces again when the user navigates on", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("link", { name: "to about" }));
    await user.click(screen.getByRole("link", { name: "to home" }));
    expect(announcer()).toHaveTextContent("Home, page loaded");
  });

  it("moves the text to the other region on each navigation", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("link", { name: "to about" }));
    const firstHolder = regions().findIndex((r) => r.textContent !== "");
    expect(firstHolder).toBeGreaterThanOrEqual(0);

    await user.click(screen.getByRole("link", { name: "to home" }));
    const secondHolder = regions().findIndex((r) => r.textContent !== "");
    expect(secondHolder).not.toBe(firstHolder);
    // ...and the region that spoke last time is empty again, ready to be the
    // one that changes next time.
    expect(regions()[firstHolder]).toHaveTextContent("");
  });

  it("announces a Back navigation onto the entry the stack started on", async () => {
    // That entry keeps the key `"default"` for the life of the stack, so a
    // `key !== "default"` test alone would go quiet on the way back.
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: <Shell />,
          children: [
            { index: true, handle: { title: "Home" }, element: <h1>Home</h1> },
            { path: "about", handle: { title: "About" }, element: <h1>About</h1> },
          ],
        },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);

    await user.click(screen.getByRole("link", { name: "to about" }));
    expect(announcer()).toHaveTextContent("About, page loaded");

    await act(async () => {
      await router.navigate(-1);
    });
    expect(announcer()).toHaveTextContent("Home, page loaded");
  });

  it("says nothing for a route that declares no title", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: <Shell />,
          children: [
            { index: true, handle: { title: "Home" }, element: <h1>Home</h1> },
            { path: "about", element: <h1>Untitled</h1> },
          ],
        },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);

    await user.click(screen.getByRole("link", { name: "to about" }));
    expect(announcer()).toHaveTextContent("");
  });

  it("sets the document title on the initial load as well", () => {
    // The announcement and the tab title are decided separately on purpose:
    // one is an event, the other is a state.
    renderApp(["/about"]);
    expect(document.title).toBe(`About · ${APP_NAME}`);
  });

  it("updates the document title on navigation", async () => {
    const user = userEvent.setup();
    renderApp();
    expect(document.title).toBe(`Home · ${APP_NAME}`);

    await user.click(screen.getByRole("link", { name: "to about" }));
    expect(document.title).toBe(`About · ${APP_NAME}`);
  });

  it("falls back to the bare product name for an untitled route", () => {
    renderApp(["/untitled"]);
    expect(document.title).toBe(APP_NAME);
  });

  it("moves focus to the main landmark after a navigation", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("link", { name: "to about" }));
    expect(document.activeElement).toBe(document.getElementById(MAIN_CONTENT_ID));
  });

  it("leaves focus alone on the initial load", async () => {
    const user = userEvent.setup();
    renderApp();

    // Nothing has navigated, so the first Tab still starts at the top of the
    // document rather than inside the content.
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "to about" }));
  });

  it("moves focus even when the page has no announceable title", async () => {
    // The two halves are decided from the same signal but answer different
    // questions: a missing title is a reason to stay quiet, not a reason to
    // strand a keyboard user on a link to a page that is no longer there.
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("link", { name: "to untitled" }));
    expect(announcer()).toHaveTextContent("");
    expect(document.activeElement).toBe(document.getElementById(MAIN_CONTENT_ID));
  });

  it("does nothing when the focus target is not in the document", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <div>
              <RouteAnnouncer focusTargetId="not-rendered" />
              <Link to="/about">to about</Link>
              <Outlet />
            </div>
          ),
          children: [
            { index: true, handle: { title: "Home" }, element: <h1>Home</h1> },
            { path: "about", handle: { title: "About" }, element: <h1>About</h1> },
          ],
        },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);

    await user.click(screen.getByRole("link", { name: "to about" }));
    // Still announced — the announcement does not depend on the focus target.
    expect(announcer()).toHaveTextContent("About, page loaded");
  });
});
