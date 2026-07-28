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

  it("renders NotFoundPage for unknown routes", async () => {
    renderRoute("/this-does-not-exist");
    await waitFor(() => {
      expect(screen.getByText("404")).toBeInTheDocument();
    });
  });
});
