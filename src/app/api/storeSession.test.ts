import { describe, it, expect, vi, afterEach } from "vitest";
import { createStoreSessionPort } from "@/app/api/storeSession";
import { setCredentials } from "@/entities/session/authSlice";
import { makeStore, type TestStore } from "@/test/renderWithProviders";
import { env } from "@/shared/config/env";

const REFRESH_URL = `${env.VITE_API_URL}/auth/refresh`;

function seededStore(): TestStore {
  const store = makeStore();
  store.dispatch(
    setCredentials({
      token: "mock-access-token",
      refreshToken: "mock-refresh-token",
      expiresIn: 900,
      user: { id: "1", email: "test@example.com", role: "user" },
    }),
  );
  return store;
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("createStoreSessionPort", () => {
  it("reads the current access token from the store", () => {
    const port = createStoreSessionPort(seededStore());
    expect(port.getAccessToken()).toBe("mock-access-token");
  });

  it("returns null without a request when there is no refresh token", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const port = createStoreSessionPort(makeStore());

    await expect(port.refreshAccessToken()).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("exchanges the refresh token and writes the new access token to the store", async () => {
    const store = seededStore();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ token: "mock-refreshed-token", expiresIn: 900 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const port = createStoreSessionPort(store);

    await expect(port.refreshAccessToken()).resolves.toBe("mock-refreshed-token");
    expect(store.getState().auth.token).toBe("mock-refreshed-token");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      REFRESH_URL,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns null and leaves the store alone when the refresh is rejected", async () => {
    const store = seededStore();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));

    await expect(createStoreSessionPort(store).refreshAccessToken()).resolves.toBeNull();
    expect(store.getState().auth.token).toBe("mock-access-token");
  });

  it("clears the session on expiry", () => {
    const store = seededStore();

    createStoreSessionPort(store).onSessionExpired();

    expect(store.getState().auth).toMatchObject({ token: null, refreshToken: null, user: null });
  });
});
