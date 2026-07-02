import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Sidebar } from "./Sidebar";

const mockCloseSidebar = vi.fn();

const mockUiState = {
  sidebarOpen: false,
  closeSidebar: mockCloseSidebar,
  toggleSidebar: vi.fn(),
};

vi.mock("@/store/zustand", () => ({
  useUi: () => mockUiState,
}));

function renderSidebar(initialPath = "/", sidebarOpen = false) {
  mockUiState.sidebarOpen = sidebarOpen;
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe("Sidebar", () => {
  beforeEach(() => {
    mockCloseSidebar.mockClear();
    mockUiState.sidebarOpen = false;
  });

  it("renders the sidebar with all navigation links", () => {
    renderSidebar();
    const nav = screen.getByRole("navigation", { name: "Sidebar navigation" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "About" })).toBeInTheDocument();
  });

  it("does not show the backdrop when sidebar is closed", () => {
    renderSidebar("/", false);
    expect(screen.queryByTestId("sidebar-backdrop")).not.toBeInTheDocument();
  });

  it("shows the backdrop when sidebar is open on mobile", () => {
    renderSidebar("/", true);
    // Backdrop is the div with aria-hidden="true" that appears when sidebarOpen
    const backdrop = document.querySelector('[aria-hidden="true"]');
    expect(backdrop).toBeInTheDocument();
  });

  it("calls closeSidebar when backdrop is clicked", () => {
    renderSidebar("/", true);
    const backdrop = document.querySelector('[aria-hidden="true"]') as HTMLElement;
    fireEvent.click(backdrop);
    expect(mockCloseSidebar).toHaveBeenCalledOnce();
  });

  it("calls closeSidebar when a nav link is clicked", () => {
    renderSidebar("/", true);
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    expect(mockCloseSidebar).toHaveBeenCalledOnce();
  });

  it("applies slide-out transform class when sidebar is closed", () => {
    renderSidebar("/", false);
    const aside = screen.getByRole("complementary");
    expect(aside.className).toContain("-translate-x-full");
  });

  it("applies slide-in transform class when sidebar is open", () => {
    renderSidebar("/", true);
    const aside = screen.getByRole("complementary");
    expect(aside.className).toContain("translate-x-0");
  });

  it("marks the active route link", () => {
    renderSidebar("/dashboard");
    const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboardLink).toHaveAttribute("aria-current", "page");
  });
});
