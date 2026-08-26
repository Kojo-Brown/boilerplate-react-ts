import { MemoryRouter, useLocation } from "react-router";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  RouteTransitionProvider,
  useRouteTransition,
} from "@/features/route-transition/routeTransition";

function LocationReadout() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname + location.search}</span>;
}

function TransitionReadout() {
  const { isPending, pendingHref, navigate } = useRouteTransition();
  return (
    <div>
      <button
        onClick={() => {
          navigate("/about");
        }}
      >
        go to about
      </button>
      <button
        onClick={() => {
          navigate({ pathname: "/about", search: "?tab=team" });
        }}
      >
        go with search
      </button>
      <span data-testid="is-pending">{isPending ? "pending" : "idle"}</span>
      <span data-testid="pending-href">{pendingHref ?? "none"}</span>
    </div>
  );
}

function renderProvider() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <RouteTransitionProvider>
        <LocationReadout />
        <TransitionReadout />
      </RouteTransitionProvider>
    </MemoryRouter>,
  );
}

describe("RouteTransitionProvider", () => {
  it("navigates", async () => {
    renderProvider();
    expect(screen.getByTestId("location")).toHaveTextContent("/");

    await act(async () => {
      screen.getByText("go to about").click();
      await Promise.resolve();
    });

    expect(screen.getByTestId("location")).toHaveTextContent("/about");
  });

  it("accepts a partial path destination", async () => {
    renderProvider();
    await act(async () => {
      screen.getByText("go with search").click();
      await Promise.resolve();
    });
    expect(screen.getByTestId("location")).toHaveTextContent("/about?tab=team");
  });

  it("reports no pending destination once a navigation has settled", async () => {
    // `pendingHref` is derived from `isPending` rather than cleared by an
    // effect, so there is no window in which a settled navigation still names
    // a destination. Nothing suspends here, so the navigation settles within
    // its own commit and idle is the only state ever observed.
    renderProvider();
    await act(async () => {
      screen.getByText("go to about").click();
      await Promise.resolve();
    });

    expect(screen.getByTestId("is-pending")).toHaveTextContent("idle");
    expect(screen.getByTestId("pending-href")).toHaveTextContent("none");
  });
});

describe("useRouteTransition", () => {
  it("throws outside a provider rather than silently navigating untransitioned", () => {
    // The failure has to be loud. A default value would let a link navigate
    // without the hold and look identical while doing it, which is the exact
    // bug this module removes.
    expect(() =>
      render(
        <MemoryRouter>
          <TransitionReadout />
        </MemoryRouter>,
      ),
    ).toThrow(/RouteTransitionProvider/);
  });
});
