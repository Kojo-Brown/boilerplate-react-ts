import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { Provider } from "react-redux";
import { makeStore } from "@/test/renderWithProviders";
import { setCredentials } from "@/store/authSlice";
import { ProtectedRoute } from "./ProtectedRoute";

function LocationStateDisplay() {
  const location = useLocation();
  const state = location.state as { from?: { pathname: string } } | null;
  return <div data-testid="from-path">{state?.from?.pathname ?? "none"}</div>;
}

function buildTestRouter(
  initialPath: string,
  store: ReturnType<typeof makeStore>,
  redirectTo?: string,
) {
  const routes = [
    {
      path: "/",
      element: redirectTo ? <ProtectedRoute redirectTo={redirectTo} /> : <ProtectedRoute />,
      children: [{ index: true, element: <div>Protected Content</div> }],
    },
    {
      path: "/dashboard",
      element: <ProtectedRoute />,
      children: [{ index: true, element: <div>Dashboard Content</div> }],
    },
    { path: "/login", element: <div>Login Page <LocationStateDisplay /></div> },
    { path: "/custom-login", element: <div>Custom Login</div> },
  ];

  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });

  return render(
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>,
  );
}

describe("ProtectedRoute", () => {
  it("redirects to /login when the user is not authenticated", async () => {
    const store = makeStore();
    buildTestRouter("/", store);
    expect(await screen.findByText(/Login Page/)).toBeInTheDocument();
  });

  it("renders child routes when the user is authenticated", async () => {
    const store = makeStore();
    store.dispatch(
      setCredentials({
        token: "tok-abc",
        user: { id: "1", email: "user@example.com", role: "user" },
      }),
    );
    buildTestRouter("/", store);
    expect(await screen.findByText("Protected Content")).toBeInTheDocument();
  });

  it("preserves the attempted URL in redirect state", async () => {
    const store = makeStore();
    buildTestRouter("/dashboard", store);
    expect(await screen.findByText(/Login Page/)).toBeInTheDocument();
    expect(screen.getByTestId("from-path")).toHaveTextContent("/dashboard");
  });

  it("respects a custom redirectTo prop", async () => {
    const store = makeStore();
    buildTestRouter("/", store, "/custom-login");
    expect(await screen.findByText("Custom Login")).toBeInTheDocument();
  });
});
