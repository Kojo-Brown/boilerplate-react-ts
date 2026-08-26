import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RouteTransitionHarness } from "@/test/routeTransitionHarness";
import { Navbar } from "@/widgets/layout/Navbar";

const mockToggleSidebar = vi.fn();

vi.mock("@/shared/store/zustand", () => ({
  useUi: () => ({
    sidebarOpen: false,
    toggleSidebar: mockToggleSidebar,
    closeSidebar: vi.fn(),
  }),
}));

function renderNavbar(initialPath = "/") {
  return render(
    <RouteTransitionHarness initialEntries={[initialPath]}>
      <Navbar />
    </RouteTransitionHarness>,
  );
}

describe("Navbar", () => {
  beforeEach(() => {
    mockToggleSidebar.mockClear();
  });

  it("renders the brand link pointing to home", () => {
    renderNavbar();
    const brand = screen.getByRole("link", { name: /react ts/i });
    expect(brand).toBeInTheDocument();
    expect(brand).toHaveAttribute("href", "/");
  });

  it("renders main navigation with all route links", () => {
    renderNavbar();
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "About" })).toBeInTheDocument();
  });

  it("renders mobile hamburger toggle button", () => {
    renderNavbar();
    expect(screen.getByRole("button", { name: "Toggle sidebar" })).toBeInTheDocument();
  });

  it("calls toggleSidebar when hamburger button is clicked", () => {
    renderNavbar();
    fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));
    expect(mockToggleSidebar).toHaveBeenCalledOnce();
  });

  it("marks the active route link", () => {
    renderNavbar("/dashboard");
    const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboardLink).toHaveAttribute("aria-current", "page");
  });
});
