import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RootLayout } from "@/widgets/layout/RootLayout";
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
