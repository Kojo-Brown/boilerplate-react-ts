import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { Provider } from "react-redux";
import { makeStore } from "@/test/renderWithProviders";
import { setCredentials, sessionRestoreStarted, logout } from "@/entities/session/authSlice";
import type { UserRole } from "@/entities/session/authSlice";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";

function LocationStateDisplay() {
  const location = useLocation();
  const state = location.state as { from?: { pathname: string } } | null;
  return <div data-testid="from-path">{state?.from?.pathname ?? "none"}</div>;
}

function buildTestRouter(
  initialPath: string,
  store: ReturnType<typeof makeStore>,
  redirectTo?: string,
  requiredRoles?: readonly UserRole[],
) {
  const routes = [
    {
      path: "/",
      element: <ProtectedRoute redirectTo={redirectTo} requiredRoles={requiredRoles} />,
      children: [{ index: true, element: <div>Protected Content</div> }],
    },
    {
      path: "/dashboard",
      element: <ProtectedRoute />,
      children: [{ index: true, element: <div>Dashboard Content</div> }],
    },
    {
      path: "/login",
      element: (
        <div>
          Login Page <LocationStateDisplay />
        </div>
      ),
    },
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
  /*
    The branch that exists because the access token is no longer persisted.

    A reload begins with an empty store and a refresh in flight, so for one
    round trip a signed-in user looks exactly like a signed-out one. Redirecting
    on `!token` alone — which was right when the token was read synchronously
    out of `localStorage` — would bounce every returning user to `/login` on
    every reload and leave them there, since the restore completing does not
    un-navigate them.

    These four cases pin the whole state machine, because the failure mode in
    either direction is bad: redirect too eagerly and you log people out on
    refresh; wait too eagerly and an anonymous visitor hangs on a spinner that
    nothing will ever resolve.
  */
  describe("while a session is being restored", () => {
    it("waits instead of redirecting", async () => {
      const store = makeStore();
      store.dispatch(sessionRestoreStarted());
      buildTestRouter("/", store);

      expect(await screen.findByRole("status", { name: "Loading page" })).toBeInTheDocument();
      expect(screen.queryByText(/Login Page/)).not.toBeInTheDocument();
      expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
    });

    it("renders the protected route once the restore succeeds", async () => {
      const store = makeStore();
      store.dispatch(sessionRestoreStarted());
      buildTestRouter("/", store);
      await screen.findByRole("status", { name: "Loading page" });

      store.dispatch(
        setCredentials({
          token: "restored-token",
          expiresIn: 900,
          user: { id: "1", email: "test@example.com", role: "user" },
        }),
      );

      expect(await screen.findByText("Protected Content")).toBeInTheDocument();
    });

    it("redirects once the restore finds no session", async () => {
      const store = makeStore();
      store.dispatch(sessionRestoreStarted());
      buildTestRouter("/", store);
      await screen.findByRole("status", { name: "Loading page" });

      store.dispatch(logout());

      expect(await screen.findByText(/Login Page/)).toBeInTheDocument();
    });

    it("does not wait when nothing is restoring, so a cold visit still redirects", async () => {
      // `restoring` is entered only by `sessionRestoreStarted`, never by
      // `initialState`. Were it the initial state, this case would hang.
      const store = makeStore();
      buildTestRouter("/", store);
      expect(await screen.findByText(/Login Page/)).toBeInTheDocument();
    });
  });

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
        expiresIn: 900,
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

  it("allows access when user has the required role", async () => {
    const store = makeStore();
    store.dispatch(
      setCredentials({
        token: "tok-abc",
        expiresIn: 900,
        user: { id: "1", email: "admin@example.com", role: "admin" },
      }),
    );
    buildTestRouter("/", store, undefined, ["admin"]);
    expect(await screen.findByText("Protected Content")).toBeInTheDocument();
  });

  it("allows access when user has any of the required roles", async () => {
    const store = makeStore();
    store.dispatch(
      setCredentials({
        token: "tok-abc",
        expiresIn: 900,
        user: { id: "1", email: "editor@example.com", role: "editor" },
      }),
    );
    buildTestRouter("/", store, undefined, ["admin", "editor"]);
    expect(await screen.findByText("Protected Content")).toBeInTheDocument();
  });

  it("redirects when user lacks the required role", async () => {
    const store = makeStore();
    store.dispatch(
      setCredentials({
        token: "tok-abc",
        expiresIn: 900,
        user: { id: "1", email: "user@example.com", role: "user" },
      }),
    );
    buildTestRouter("/", store, undefined, ["admin"]);
    expect(await screen.findByText(/Login Page/)).toBeInTheDocument();
  });
});
