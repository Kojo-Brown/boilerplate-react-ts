import { createMemoryRouter, RouterProvider } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { routes } from "@/router";

function renderRoute(initialPath: string) {
  const memoryRouter = createMemoryRouter(routes, {
    initialEntries: [initialPath],
  });
  return render(<RouterProvider router={memoryRouter} />);
}

describe("router", () => {
  it("renders HomePage at /", async () => {
    renderRoute("/");
    await waitFor(() => {
      expect(
        screen.getByText("React TS Boilerplate"),
      ).toBeInTheDocument();
    });
  });

  it("renders DashboardPage at /dashboard", async () => {
    renderRoute("/dashboard");
    await waitFor(() => {
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });
  });

  it("renders AboutPage at /about", async () => {
    renderRoute("/about");
    await waitFor(() => {
      expect(screen.getByText("About")).toBeInTheDocument();
    });
  });

  it("renders NotFoundPage for unknown routes", async () => {
    renderRoute("/this-does-not-exist");
    await waitFor(() => {
      expect(screen.getByText("404")).toBeInTheDocument();
    });
  });
});
