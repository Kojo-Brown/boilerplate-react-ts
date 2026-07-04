import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderWithProviders } from "@/test/renderWithProviders";
import { setCredentials, AUTH_STORAGE_KEYS } from "@/store/authSlice";
import { useLoginMutation, useRefreshMutation, useLogoutUserMutation } from "./authApi";

const API = "http://localhost:4000";
const mockUser = { id: "1", email: "test@example.com", role: "user" };

function LoginButton() {
  const [login, { isLoading, isSuccess, isError }] = useLoginMutation();
  return (
    <div>
      <button onClick={() => void login({ email: "test@example.com", password: "password123" })}>
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
      <button onClick={() => void refresh("my-refresh-token")}>Refresh</button>
      {isLoading && <p>Refreshing...</p>}
      {isSuccess && <p>Refreshed!</p>}
    </div>
  );
}

function LogoutButton() {
  const [logoutUser, { isSuccess }] = useLogoutUserMutation();
  return (
    <div>
      <button onClick={() => void logoutUser()}>Logout</button>
      {isSuccess && <p>Logged out!</p>}
    </div>
  );
}

describe("authApi — useLoginMutation", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores credentials in Redux state on successful login", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json({
          token: "access-tok",
          refreshToken: "ref-tok",
          expiresIn: 900,
          user: mockUser,
        }),
      ),
    );

    const { store } = renderWithProviders(<LoginButton />);
    await user.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => expect(screen.getByText("Logged in!")).toBeInTheDocument());

    const authState = store.getState().auth;
    expect(authState.token).toBe("access-tok");
    expect(authState.refreshToken).toBe("ref-tok");
    expect(authState.user).toEqual(mockUser);
    expect(authState.expiresAt).toBeGreaterThan(Date.now());
  });

  it("persists access token and refresh token to localStorage on login", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json({
          token: "access-tok",
          refreshToken: "ref-tok",
          expiresIn: 900,
          user: mockUser,
        }),
      ),
    );

    renderWithProviders(<LoginButton />);
    await user.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => {
      expect(localStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN)).toBe("access-tok");
      expect(localStorage.getItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN)).toBe("ref-tok");
    });
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

    await waitFor(() => expect(screen.getByText("Error!")).toBeInTheDocument());
  });
});

describe("authApi — useRefreshMutation", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("updates the access token in Redux state after a successful refresh", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/auth/refresh`, () =>
        HttpResponse.json({ token: "new-access-tok", expiresIn: 900 }),
      ),
    );

    const { store } = renderWithProviders(<RefreshButton />);
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(screen.getByText("Refreshed!")).toBeInTheDocument());

    expect(store.getState().auth.token).toBe("new-access-tok");
    expect(store.getState().auth.expiresAt).toBeGreaterThan(Date.now());
  });

  it("updates the access token in localStorage after refresh", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/auth/refresh`, () =>
        HttpResponse.json({ token: "new-access-tok", expiresIn: 900 }),
      ),
    );

    renderWithProviders(<RefreshButton />);
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(localStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN)).toBe("new-access-tok");
    });
  });
});

describe("authApi — useLogoutUserMutation", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("clears auth state in Redux after logout", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/auth/logout`, () => new HttpResponse(null, { status: 200 })),
    );

    const { store } = renderWithProviders(<LogoutButton />);
    store.dispatch(
      setCredentials({
        token: "tok",
        refreshToken: "ref",
        expiresIn: 900,
        user: mockUser,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Logout" }));

    await waitFor(() => expect(screen.getByText("Logged out!")).toBeInTheDocument());

    const authState = store.getState().auth;
    expect(authState.token).toBeNull();
    expect(authState.refreshToken).toBeNull();
    expect(authState.user).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN)).toBeNull();
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
        refreshToken: "ref",
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
