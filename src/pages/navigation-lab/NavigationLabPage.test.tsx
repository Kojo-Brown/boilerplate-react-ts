import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NavigationLabPage } from "@/pages/navigation-lab/NavigationLabPage";
import { RouteTransitionHarness } from "@/test/routeTransitionHarness";

function renderLab(search = "") {
  return render(
    <RouteTransitionHarness initialEntries={[`/labs/navigation${search}`]}>
      <NavigationLabPage />
    </RouteTransitionHarness>,
  );
}

describe("NavigationLabPage", () => {
  it("defaults to the hoisted boundary, which is what the app does", () => {
    renderLab();
    expect(screen.getByRole("button", { name: "Hoisted boundary" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Boundary in the route" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("reads the placement from the URL so a run is shareable", () => {
    renderLab("?boundary=per-route");
    expect(screen.getByRole("button", { name: "Boundary in the route" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("puts the whole configuration into the destination link", () => {
    renderLab("?boundary=per-route&latency=600&run=2");
    expect(screen.getByTestId("open-slow-route")).toHaveAttribute(
      "href",
      "/labs/navigation/slow?boundary=per-route&latency=600&run=3",
    );
  });

  it("advances the run counter so a repeat visit suspends again", () => {
    // Without a new run the destination's promise is already settled and the
    // second click arrives instantly, demonstrating nothing.
    renderLab("?run=4");
    expect(screen.getByTestId("open-slow-route").getAttribute("href")).toContain("run=5");
  });

  it("switches placement through the URL rather than local state", () => {
    renderLab();
    fireEvent.click(screen.getByRole("button", { name: "Boundary in the route" }));
    expect(screen.getByTestId("open-slow-route").getAttribute("href")).toContain(
      "boundary=per-route",
    );
  });

  it("changes the latency of the next run", () => {
    renderLab();
    fireEvent.change(screen.getByTestId("route-latency-select"), { target: { value: "5000" } });
    expect(screen.getByTestId("open-slow-route").getAttribute("href")).toContain("latency=5000");
  });

  it("counts clicks on the interactivity probe", () => {
    // The probe is the only thing that can distinguish a held page from a
    // frozen one — both look identical.
    renderLab();
    const probe = screen.getByTestId("interactivity-probe");
    expect(probe).toHaveTextContent("Clicked 0 times");
    fireEvent.click(probe);
    fireEvent.click(probe);
    expect(probe).toHaveTextContent("Clicked 2 times");
  });

  it("reads as idle when no navigation is in flight", () => {
    renderLab();
    expect(screen.getByTestId("pending-readout")).toHaveTextContent("Idle");
  });
});
