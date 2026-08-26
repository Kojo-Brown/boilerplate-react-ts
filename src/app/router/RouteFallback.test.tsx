import { MemoryRouter } from "react-router";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RouteFallback } from "@/app/router/RouteFallback";

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <RouteFallback />
    </MemoryRouter>,
  );
}

describe("RouteFallback", () => {
  // Hoisting the boundary would ordinarily cost the per-route skeletons, since
  // one boundary can only have one fallback. Choosing by pathname keeps both.
  it.each([
    ["/", "Loading home page"],
    ["/dashboard", "Loading dashboard"],
    ["/about", "Loading about page"],
  ])("renders the %s skeleton", (pathname, label) => {
    renderAt(pathname);
    expect(screen.getByRole("status", { name: label })).toBeInTheDocument();
  });

  it("falls back to the generic loader for a route with no skeleton", () => {
    renderAt("/labs/streaming");
    expect(screen.getByRole("status", { name: "Loading page" })).toBeInTheDocument();
  });

  it("falls back to the generic loader for an unknown path", () => {
    renderAt("/nothing-here");
    expect(screen.getByRole("status", { name: "Loading page" })).toBeInTheDocument();
  });
});
