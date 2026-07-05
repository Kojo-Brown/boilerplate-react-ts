import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { http, HttpResponse } from "msw";
import { Provider } from "react-redux";
import { server } from "@/test/mocks/server";
import { makeStore } from "@/test/renderWithProviders";
import { AUTH_STORAGE_KEYS } from "@/store/authSlice";
import { OAUTH_STORAGE_KEYS } from "@/features/auth/oauth";
import { OAuthCallbackPage } from "./OAuthCallbackPage";

const API = "http://localhost:4000";

function buildRouter(callbackUrl: string) {
  return createMemoryRouter(
    [
      { path: "/auth/callback", element: <OAuthCallbackPage /> },
      { path: "/dashboard", element: <div>Dashboard</div> },
      { path: "/login", element: <div>Login Page</div> },
    ],
    { initialEntries: [callbackUrl] },
  );
}

function renderCallback(callbackUrl: string) {
  const store = makeStore();
  const router = buildRouter(callbackUrl);
  render(
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>,
  );
  return { store };
}

describe("OAuthCallbackPage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("redirects to login when code parameter is missing", async () => {
    renderCallback("/auth/callback?state=some-state");
    expect(await screen.findByText("Login Page")).toBeInTheDocument();
  });

  it("redirects to login when state parameter is missing", async () => {
    renderCallback("/auth/callback?code=some-code");
    expect(await screen.findByText("Login Page")).toBeInTheDocument();
  });

  it("redirects to login when the provider returns an error", async () => {
    renderCallback("/auth/callback?error=access_denied");
    expect(await screen.findByText("Login Page")).toBeInTheDocument();
  });

  it("redirects to login on state mismatch", async () => {
    sessionStorage.setItem(OAUTH_STORAGE_KEYS.STATE, "expected-state");
    sessionStorage.setItem(OAUTH_STORAGE_KEYS.CODE_VERIFIER, "verifier");
    renderCallback("/auth/callback?code=AUTH_CODE&state=wrong-state");
    expect(await screen.findByText("Login Page")).toBeInTheDocument();
  });

  it("exchanges the code and redirects to dashboard on success", async () => {
    sessionStorage.setItem(OAUTH_STORAGE_KEYS.STATE, "valid-state");
    sessionStorage.setItem(OAUTH_STORAGE_KEYS.CODE_VERIFIER, "verifier123");
    const { store } = renderCallback("/auth/callback?code=AUTH_CODE&state=valid-state");
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(store.getState().auth.token).toBe("google-access-token");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN)).toBe("google-access-token");
  });

  it("redirects to login when the token exchange API fails", async () => {
    server.use(
      http.post(`${API}/auth/google/callback`, () =>
        HttpResponse.json({ message: "Invalid authorization code" }, { status: 400 }),
      ),
    );
    sessionStorage.setItem(OAUTH_STORAGE_KEYS.STATE, "valid-state");
    sessionStorage.setItem(OAUTH_STORAGE_KEYS.CODE_VERIFIER, "verifier123");
    renderCallback("/auth/callback?code=BAD_CODE&state=valid-state");
    expect(await screen.findByText("Login Page")).toBeInTheDocument();
  });
});
