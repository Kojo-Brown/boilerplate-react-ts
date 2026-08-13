import { screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RoutePendingBar } from "@/components/navigation/RoutePendingBar";
import { TransitionLink } from "@/components/navigation/TransitionLink";
import { clickAndHold, renderHeldNavigationApp } from "@/test/heldNavigation";

function renderBar() {
  return renderHeldNavigationApp({
    chrome: (
      <>
        <RoutePendingBar />
        <TransitionLink to="/next">Next</TransitionLink>
      </>
    ),
  });
}

describe("RoutePendingBar", () => {
  it("is idle and announces nothing before a navigation", () => {
    renderBar();
    expect(screen.getByTestId("route-pending-bar")).toHaveAttribute("data-pending", "false");
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("shows and announces the destination while a navigation is held", async () => {
    const app = renderBar();

    await clickAndHold(screen.getByRole("link", { name: "Next" }));

    expect(screen.getByTestId("route-pending-bar")).toHaveAttribute("data-pending", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading /next");
    // The whole reason the bar exists: the page has not changed, so without it
    // a click on a slow route produces no visible change at all.
    expect(screen.getByText("PREVIOUS PAGE")).toBeInTheDocument();

    await app.arrive();
  });

  it("clears once the destination arrives", async () => {
    const app = renderBar();
    await clickAndHold(screen.getByRole("link", { name: "Next" }));
    await app.arrive();

    expect(screen.getByText("NEXT PAGE")).toBeInTheDocument();
    expect(screen.getByTestId("route-pending-bar")).toHaveAttribute("data-pending", "false");
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("keeps the bar itself out of the accessibility tree", () => {
    // The announcement is a separate live region. Labelling the bar would put
    // a second `role="status"` accessible name beside the nav landmark, which
    // is the collision that made the page skeletons decorative.
    renderBar();
    expect(screen.getByTestId("route-pending-bar")).toHaveAttribute("aria-hidden", "true");
  });
});
