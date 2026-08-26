import { useLocation } from "react-router";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TransitionLink } from "@/features/route-transition/TransitionLink";
import { RouteTransitionHarness } from "@/test/routeTransitionHarness";

function LocationReadout() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

/**
 * Clicks and lets the transition finish.
 *
 * A plain `<Link>` updates the location within `fireEvent`; this one does not.
 * The navigation is awaited inside `startTransition`, so it resolves on a
 * microtask and asserting straight after the click reads the old location.
 * Anything testing a transitioned link needs this, which is worth knowing
 * before spending an afternoon on a link that "does not navigate".
 */
async function clickAndFlush(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
  });
}

function renderLink(ui: React.ReactElement) {
  return render(
    <RouteTransitionHarness>
      <LocationReadout />
      {ui}
    </RouteTransitionHarness>,
  );
}

describe("TransitionLink", () => {
  it("renders a real anchor with an href", () => {
    renderLink(<TransitionLink to="/about">About</TransitionLink>);
    // Still a document link: middle-click, "copy link address" and the status
    // bar all depend on the href being real, and the transition costs nothing
    // to keep them.
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
  });

  it("navigates on a plain click", async () => {
    renderLink(<TransitionLink to="/about">About</TransitionLink>);
    await clickAndFlush(screen.getByRole("link", { name: "About" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/about");
  });

  it("runs a caller's onClick before deciding", async () => {
    const onClick = vi.fn();
    renderLink(
      <TransitionLink to="/about" onClick={onClick}>
        About
      </TransitionLink>,
    );
    await clickAndFlush(screen.getByRole("link", { name: "About" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("location")).toHaveTextContent("/about");
  });

  it("declines a click the caller has already handled", async () => {
    renderLink(
      <TransitionLink
        to="/about"
        onClick={(event) => {
          event.preventDefault();
        }}
      >
        About
      </TransitionLink>,
    );
    await clickAndFlush(screen.getByRole("link", { name: "About" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/");
  });

  // Each of these is a request for a new tab or window, which means a document
  // load. Taking it over would break a control users expect everywhere, so the
  // event is left un-prevented and the browser keeps it.
  it.each([
    ["meta", { metaKey: true }],
    ["ctrl", { ctrlKey: true }],
    ["shift", { shiftKey: true }],
    ["alt", { altKey: true }],
  ])("leaves a %s-click to the browser", (_label, modifiers) => {
    renderLink(<TransitionLink to="/about">About</TransitionLink>);
    const link = screen.getByRole("link", { name: "About" });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers });
    fireEvent(link, event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves a non-primary button click to the browser", () => {
    renderLink(<TransitionLink to="/about">About</TransitionLink>);
    const link = screen.getByRole("link", { name: "About" });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 1 });
    fireEvent(link, event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves a click on a link targeting another window to the browser", () => {
    renderLink(
      <TransitionLink to="/about" target="_blank">
        About
      </TransitionLink>,
    );
    const link = screen.getByRole("link", { name: "About" });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    fireEvent(link, event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("still handles a click on an explicitly self-targeted link", async () => {
    renderLink(
      <TransitionLink to="/about" target="_self">
        About
      </TransitionLink>,
    );
    await clickAndFlush(screen.getByRole("link", { name: "About" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/about");
  });

  it("carries no pending marker while idle", () => {
    renderLink(<TransitionLink to="/about">About</TransitionLink>);
    expect(screen.getByRole("link", { name: "About" })).not.toHaveAttribute("data-pending");
  });
});
