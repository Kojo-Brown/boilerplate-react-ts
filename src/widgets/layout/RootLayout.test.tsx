import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RootLayout } from "@/widgets/layout/RootLayout";
import { MAIN_CONTENT_ID } from "@/shared/ui/SkipLink";
import type { ChunkRegistry } from "@/shared/lib/idlePrefetchQueue";

// Nothing in this file asserts on prefetching; an empty registry is what the
// layout looks like with no lazy routes registered.
const NO_CHUNKS: ChunkRegistry = {};

vi.mock("@/shared/store/zustand", () => ({
  useUi: () => ({
    sidebarOpen: false,
    toggleSidebar: vi.fn(),
    closeSidebar: vi.fn(),
  }),
}));

function renderLayout() {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <RootLayout fallback={<div>Loading page</div>} prefetchRegistry={NO_CHUNKS} />,
        children: [
          {
            index: true,
            handle: { title: "Home" },
            element: <div>Page content</div>,
          },
        ],
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("RootLayout", () => {
  it("renders the navbar", () => {
    renderLayout();
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("renders the sidebar", () => {
    renderLayout();
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it("renders the outlet (child page content)", () => {
    renderLayout();
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });

  it("renders the brand link in the navbar", () => {
    renderLayout();
    expect(screen.getByRole("link", { name: /react ts/i })).toBeInTheDocument();
  });

  it("renders sidebar navigation links", () => {
    renderLayout();
    const sidebarNav = screen.getByRole("navigation", { name: "Sidebar navigation" });
    expect(sidebarNav).toBeInTheDocument();
  });
});

describe("RootLayout focus management", () => {
  it("puts the routed page in a main landmark", () => {
    renderLayout();
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", MAIN_CONTENT_ID);
    expect(main).toContainElement(screen.getByText("Page content"));
  });

  it("makes main focusable without putting it in the tab order", () => {
    // Both the skip link and the route announcer send focus here, and a
    // `focus()` on a non-focusable element is swallowed silently.
    renderLayout();
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
  });

  it("offers the skip link as the first thing Tab reaches", async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Skip to main content" }));
  });

  it("skips past the header and nav to the main landmark", async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByRole("link", { name: "Skip to main content" }));
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("renders the route announcer's live regions, mounted and empty", () => {
    renderLayout();
    // Scoped to the announcer: `RoutePendingBar` has a `role="status"` of its
    // own, announcing the other end of the same event.
    const regions = within(screen.getByTestId("route-announcer")).getAllByRole("status");
    expect(regions).toHaveLength(2);
    for (const region of regions) {
      expect(region).toHaveAttribute("aria-live", "polite");
      expect(region).toHaveTextContent("");
    }
  });
});
