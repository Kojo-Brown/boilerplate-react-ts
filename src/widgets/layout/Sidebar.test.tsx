import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouteTransitionHarness } from "@/test/routeTransitionHarness";
import { Sidebar } from "@/widgets/layout/Sidebar";
import { MD_AND_UP } from "@/shared/config/breakpoints";

const mockCloseSidebar = vi.fn();

const mockUiState = {
  sidebarOpen: false,
  closeSidebar: mockCloseSidebar,
  toggleSidebar: vi.fn(),
};

vi.mock("@/shared/store/zustand", () => ({
  useUi: () => mockUiState,
}));

/**
 * Makes `MD_AND_UP` report a match, which is the only difference between the
 * two components this file is testing: a landmark that is always there, and a
 * modal drawer that is not.
 *
 * The suite's default `matchMedia` stub answers `false` to everything, so
 * every test that does not call this one is a phone.
 */
function widenToDesktop() {
  const real = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
    const list = real(query);
    if (query !== MD_AND_UP) return list;
    // Overridden on the instance rather than rebuilt, so the listener plumbing
    // the stub provides stays wired up — `useMediaQuery` subscribes to it.
    Object.defineProperty(list, "matches", { value: true, configurable: true });
    return list;
  });
}

function renderSidebar(initialPath = "/", sidebarOpen = false) {
  mockUiState.sidebarOpen = sidebarOpen;
  return render(
    <RouteTransitionHarness initialEntries={[initialPath]}>
      <Sidebar />
    </RouteTransitionHarness>,
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
    // An open drawer on a phone is a dialog rather than a complementary
    // landmark; `role` is asserted on its own below.
    const aside = screen.getByRole("dialog");
    expect(aside.className).toContain("translate-x-0");
  });

  it("marks the active route link", () => {
    renderSidebar("/dashboard");
    const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboardLink).toHaveAttribute("aria-current", "page");
  });
});

/**
 * The same `<aside>` is two different components depending on the viewport,
 * and only CSS says which — so everything below is about the half of that
 * decision CSS cannot make: what focus does.
 */
describe("Sidebar as a drawer", () => {
  beforeEach(() => {
    mockCloseSidebar.mockClear();
    mockUiState.sidebarOpen = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is a complementary landmark on a desktop, open or closed", () => {
    widenToDesktop();
    renderSidebar("/", true);
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("becomes a modal dialog when the drawer opens on a phone", () => {
    renderSidebar("/", true);
    const dialog = screen.getByRole("dialog", { name: "Navigation" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("is still a landmark while the drawer is closed", () => {
    renderSidebar("/", false);
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it("marks a closed drawer inert, because a transform does not untab it", () => {
    // Without this, a phone user Tabbing out of the header lands on three nav
    // links that are off screen and cannot be scrolled to.
    renderSidebar("/", false);
    expect(screen.getByRole("complementary")).toHaveAttribute("inert");
  });

  it("does not mark a desktop sidebar inert", () => {
    widenToDesktop();
    renderSidebar("/", false);
    expect(screen.getByRole("complementary")).not.toHaveAttribute("inert");
  });

  it("moves focus into the drawer when it opens", () => {
    renderSidebar("/", true);
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Home" }));
  });

  it("does not move focus on a desktop", () => {
    widenToDesktop();
    renderSidebar("/", true);
    expect(document.activeElement).toBe(document.body);
  });

  it("wraps Tab inside the open drawer", async () => {
    const user = userEvent.setup();
    renderSidebar("/", true);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Dashboard" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "About" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Home" }));
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    renderSidebar("/", true);

    await user.keyboard("{Escape}");
    expect(mockCloseSidebar).toHaveBeenCalledOnce();
  });

  it("does not close on Escape when it is not a drawer", async () => {
    const user = userEvent.setup();
    widenToDesktop();
    renderSidebar("/", true);

    await user.keyboard("{Escape}");
    expect(mockCloseSidebar).not.toHaveBeenCalled();
  });
});
