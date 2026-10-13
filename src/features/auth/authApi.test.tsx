import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/shared/mocks/server";
import { renderWithProviders } from "@/test/renderWithProviders";
import { appStorageKeys } from "@/test/localStorage";
import { setCredentials, type AuthUser } from "@/entities/session/authSlice";
import {
  useLoginMutation,
  useRefreshMutation,
  useLogoutUserMutation,
} from "@/features/auth/authApi";

const API = "http://localhost:4000";
const mockUser: AuthUser = { id: "1", email: "test@example.com", role: "user" };

function LoginButton() {
  const [login, { isLoading, isSuccess, isError }] = useLoginMutation();
  return (
    <div>
      {/* The rejection is asserted through the hook's `isError` state, so it is
          swallowed here; leaving it unhandled fails the whole Vitest run. */}
      <button
        onClick={() => {
          login({ email: "test@example.com", password: "password123" }).catch(() => undefined);
        }}
      >
        Login
      </button>
      {isLoading && <p>Loading...</p>}
      {isSuccess && <p>Logged in!</p>}
      {isError && <p>Error!</p>}
    </div>
  );
}

function RefreshButton() {
  const [refresh, { isLoading, isSuccess }] = useRefreshMutation();
  return (
    <div>
      <button
        onClick={() => {
          refresh().catch(() => undefined);
        }}
      >
        Refresh
      </button>
      {isLoading && <p>Refreshing...</p>}
      {isSuccess && <p>Refreshed!</p>}
    </div>
  );
}

function LogoutButton() {
  const [logoutUser, { isSuccess }] = useLogoutUserMutation();
  return (
    <div>
      <button
        onClick={() => {
          logoutUser().catch(() => undefined);
        }}
      >
        Logout
      </button>
      {isSuccess && <p>Logged out!</p>}
    </div>
  );
}

describe("authApi — useLoginMutation", () => {
  it("stores credentials in Redux state on successful login", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json({
          token: "access-tok",
          expiresIn: 900,
          user: mockUser,
        }),
      ),
    );

    const { store } = renderWithProviders(<LoginButton />);
    await user.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => {
      expect(screen.getByText("Logged in!")).toBeInTheDocument();
    });

    const authState = store.getState().auth;
    expect(authState.token).toBe("access-tok");
    expect(authState.user).toEqual(mockUser);
    expect(authState.expiresAt).toBeGreaterThan(Date.now());
    expect(authState.status).toBe("authenticated");
  });

  /*
    The inverse of the test that used to be here, which asserted both tokens
    reached `localStorage`. Kept as a test rather than deleted along with the
    behaviour: "login persists nothing" is the property the item buys, and it
    is the one a well-meaning fix for "I lose my session on reload" breaks.

    Asserts on the whole of storage rather than on four key names, so a
    credential written under a fifth name fails it too.
  */
  it("writes nothing to localStorage on login", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json({
          token: "access-tok",
          expiresIn: 900,
          user: mockUser,
        }),
      ),
    );

    const { store } = renderWithProviders(<LoginButton />);
    await user.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => {
      expect(store.getState().auth.token).toBe("access-tok");
    });

    expect(appStorageKeys(localStorage)).toEqual([]);
    expect(appStorageKeys(sessionStorage)).toEqual([]);
  });

  it("sends the login request with credentials so the Set-Cookie is honoured", async () => {
    const user = userEvent.setup();
    const captured: { credentials: RequestCredentials | null } = { credentials: null };
    server.use(
      http.post(`${API}/auth/login`, ({ request }) => {
        captured.credentials = request.credentials;
        return HttpResponse.json({ token: "access-tok", expiresIn: 900, user: mockUser });
      }),
    );

    renderWithProviders(<LoginButton />);
    await user.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => {
      expect(screen.getByText("Logged in!")).toBeInTheDocument();
    });

    // Without this the browser drops the refresh cookie the response sets, and
    // the session dies at the first reload with no other symptom.
    expect(captured.credentials).toBe("include");
  });

  it("shows error state when login credentials are invalid", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json({ message: "Invalid credentials" }, { status: 401 }),
      ),
    );

    renderWithProviders(<LoginButton />);
    await user.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => {
      expect(screen.getByText("Error!")).toBeInTheDocument();
    });
  });
});

describe("authApi — useRefreshMutation", () => {
  it("updates the access token in Redux state after a successful refresh", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/auth/refresh`, () =>
        HttpResponse.json({ token: "new-access-tok", expiresIn: 900, user: mockUser }),
      ),
    );

    const { store } = renderWithProviders(<RefreshButton />);
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(screen.getByText("Refreshed!")).toBeInTheDocument();
    });

    expect(store.getState().auth.token).toBe("new-access-tok");
    expect(store.getState().auth.expiresAt).toBeGreaterThan(Date.now());
  });

  it("sends no refresh token in the body and asks for the cookie instead", async () => {
    const user = userEvent.setup();
    const captured: { body: string; credentials: RequestCredentials | null } = {
      body: "unset",
      credentials: null,
    };
    server.use(
      http.post(`${API}/auth/refresh`, async ({ request }) => {
        captured.credentials = request.credentials;
        captured.body = await request.text();
        return HttpResponse.json({ token: "new-access-tok", expiresIn: 900, user: mockUser });
      }),
    );

    renderWithProviders(<RefreshButton />);
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(screen.getByText("Refreshed!")).toBeInTheDocument();
    });

    // The endpoint takes `void`, so there is nothing a call site could put
    // here — this pins that the wire agrees with the signature.
    expect(captured.body).toBe("");
    expect(captured.credentials).toBe("include");
  });

  it("writes nothing to localStorage after refresh", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/auth/refresh`, () =>
        HttpResponse.json({ token: "new-access-tok", expiresIn: 900, user: mockUser }),
      ),
    );

    renderWithProviders(<RefreshButton />);
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(screen.getByText("Refreshed!")).toBeInTheDocument();
    });

    expect(appStorageKeys(localStorage)).toEqual([]);
  });
});

describe("authApi — useLogoutUserMutation", () => {
  it("clears auth state in Redux after logout", async () => {
    const user = userEvent.setup();
    server.use(http.post(`${API}/auth/logout`, () => new HttpResponse(null, { status: 200 })));

    const { store } = renderWithProviders(<LogoutButton />);
    store.dispatch(
      setCredentials({
        token: "tok",
        expiresIn: 900,
        user: mockUser,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Logout" }));

    await waitFor(() => {
      expect(screen.getByText("Logged out!")).toBeInTheDocument();
    });

    const authState = store.getState().auth;
    expect(authState.token).toBeNull();
    expect(authState.user).toBeNull();
    expect(authState.status).toBe("anonymous");
  });

  it("clears auth state even when the server logout request fails", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/auth/logout`, () =>
        HttpResponse.json({ error: "Server error" }, { status: 500 }),
      ),
    );

    const { store } = renderWithProviders(<LogoutButton />);
    store.dispatch(
      setCredentials({
        token: "tok",
        expiresIn: 900,
        user: mockUser,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Logout" }));

    await waitFor(() => {
      expect(store.getState().auth.token).toBeNull();
    });
  });
});
