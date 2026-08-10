import { createMemoryRouter, RouterProvider } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { describe, it, expect } from "vitest";
import { routes } from "@/router";
import { makeStore } from "@/test/renderWithProviders";
import { setCredentials } from "@/store/authSlice";

function renderRoute(initialPath: string, authed = false) {
  const store = makeStore();
  if (authed) {
    store.dispatch(
      setCredentials({
        token: "tok-test",
        refreshToken: "refresh-tok-test",
        expiresIn: 900,
        user: { id: "1", email: "test@example.com", role: "user" },
      }),
    );
  }
  const memoryRouter = createMemoryRouter(routes, {
    initialEntries: [initialPath],
  });
  return render(
    <Provider store={store}>
      <RouterProvider router={memoryRouter} />
    </Provider>,
  );
}

describe("router", () => {
  it("renders HomePage at /", async () => {
    renderRoute("/");
    await waitFor(() => {
      expect(screen.getByText("React TS Boilerplate")).toBeInTheDocument();
    });
  });

  it("redirects /dashboard to /login when unauthenticated", async () => {
    renderRoute("/dashboard");
    await waitFor(() => {
      expect(screen.getByText(/Sign In/)).toBeInTheDocument();
    });
  });

  it("renders DashboardPage at /dashboard when authenticated", async () => {
    renderRoute("/dashboard", true);
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    });
  });

  it("renders AboutPage at /about", async () => {
    renderRoute("/about");
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "About" })).toBeInTheDocument();
    });
  });

  it("renders LoginPage at /login", async () => {
    renderRoute("/login");
    await waitFor(() => {
      expect(screen.getByText("Sign In")).toBeInTheDocument();
    });
  });

  it("renders ConcurrencyLabPage at /labs/concurrency", async () => {
    // A small dataset keeps this a routing assertion; the page's own tests and
    // the Playwright benchmark cover it at full size.
    renderRoute("/labs/concurrency?n=10");
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Concurrency Lab" }),
      ).toBeInTheDocument();
    });
  });

  it("renders OptimisticLabPage at /labs/optimistic", async () => {
    renderRoute("/labs/optimistic?latency=0");
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Optimistic Lab" })).toBeInTheDocument();
    });
  });

  it("renders ActionsLabPage at /labs/actions", async () => {
    renderRoute("/labs/actions?latency=0");
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Actions Lab" })).toBeInTheDocument();
    });
  });

  it("renders NotFoundPage for unknown routes", async () => {
    renderRoute("/this-does-not-exist");
    await waitFor(() => {
      expect(screen.getByText("404")).toBeInTheDocument();
    });
  });
});
