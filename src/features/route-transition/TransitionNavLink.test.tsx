import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { TransitionNavLink } from "@/features/route-transition/TransitionNavLink";
import { RouteTransitionHarness } from "@/test/routeTransitionHarness";
import { clickAndHold, renderHeldNavigationApp } from "@/test/heldNavigation";

describe("TransitionNavLink", () => {
  it("passes React Router's active state to a className function", () => {
    render(
      <RouteTransitionHarness initialEntries={["/about"]}>
        <TransitionNavLink to="/about" className={({ isActive }) => (isActive ? "on" : "off")}>
          About
        </TransitionNavLink>
      </RouteTransitionHarness>,
    );
    expect(screen.getByRole("link", { name: "About" })).toHaveClass("on");
  });

  it("accepts a plain string className", () => {
    render(
      <RouteTransitionHarness>
        <TransitionNavLink to="/about" className="static-class">
          About
        </TransitionNavLink>
      </RouteTransitionHarness>,
    );
    expect(screen.getByRole("link", { name: "About" })).toHaveClass("static-class");
  });

  it("supports children as a render function", () => {
    render(
      <RouteTransitionHarness initialEntries={["/about"]}>
        <TransitionNavLink to="/about">
          {({ isActive }) => <span>{isActive ? "here" : "elsewhere"}</span>}
        </TransitionNavLink>
      </RouteTransitionHarness>,
    );
    expect(screen.getByText("here")).toBeInTheDocument();
  });

  it("applies a style function", () => {
    render(
      <RouteTransitionHarness initialEntries={["/about"]}>
        <TransitionNavLink
          to="/about"
          style={({ isActive }) => (isActive ? { fontWeight: "bold" } : undefined)}
        >
          About
        </TransitionNavLink>
      </RouteTransitionHarness>,
    );
    expect(screen.getByRole("link", { name: "About" })).toHaveStyle({ fontWeight: "bold" });
  });

  it("marks the destination being waited on, and only that one", async () => {
    const app = renderHeldNavigationApp({
      chrome: (
        <>
          <TransitionNavLink to="/next">Next</TransitionNavLink>
          <TransitionNavLink to="/elsewhere">Elsewhere</TransitionNavLink>
        </>
      ),
    });

    const next = screen.getByRole("link", { name: "Next" });
    expect(next).not.toHaveAttribute("data-pending");

    await clickAndHold(next);

    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("data-pending", "true");
    expect(screen.getByRole("link", { name: "Elsewhere" })).not.toHaveAttribute("data-pending");

    await app.arrive();
  });

  it("reports the held destination to the render props, where the router does not", async () => {
    // React Router's own `isPending` stays false throughout: it tracks loaders,
    // and this navigation is a chunk download. A nav item that dimmed on
    // `isPending` would therefore never dim.
    const app = renderHeldNavigationApp({
      chrome: (
        <TransitionNavLink to="/next">
          {({ isPending, isPendingTarget }) => (
            <span>
              router:{isPending ? "pending" : "idle"} ours:
              {isPendingTarget ? "pending" : "idle"}
            </span>
          )}
        </TransitionNavLink>
      ),
    });

    await clickAndHold(screen.getByRole("link"));
    expect(screen.getByText(/router:idle/)).toBeInTheDocument();
    expect(screen.getByText(/ours:pending/)).toBeInTheDocument();

    await app.arrive();
  });
});
