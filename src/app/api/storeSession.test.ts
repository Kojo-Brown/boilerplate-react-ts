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
      expiresIn: 900,
      user: { id: "1", email: "test@example.com", role: "user" },
    }),
  );
  return store;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createStoreSessionPort", () => {
  it("reads the current access token from the store", () => {
    const port = createStoreSessionPort(seededStore());
    expect(port.getAccessToken()).toBe("mock-access-token");
  });

  /*
    The inverse of the test that used to be here.

    It asserted that an empty store short-circuits without a request, which was
    right when `state.auth.refreshToken` existed: the port could tell there was
    nothing to exchange. It cannot any more, and that is the intended
    consequence of moving the credential into an `HttpOnly` cookie — whether a
    renewable session exists is known to the server and the cookie jar, and to
    nothing in this process. So the request is always made and the status
    decides.

    Worth a test rather than a deletion, because reinstating the guard means
    reinstating a client-side mirror of the refresh token, which is the thing
    the item removed.
  */
  it("asks the server even with an empty store, because the cookie is unreadable", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 401 }));
    const port = createStoreSessionPort(makeStore());

    await expect(port.refreshAccessToken()).resolves.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("sends the refresh with credentials, or the cookie would never be attached", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 401 }));

    await createStoreSessionPort(makeStore()).refreshAccessToken();

    expect(fetchSpy).toHaveBeenCalledWith(
      REFRESH_URL,
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("carries no refresh token in the request body", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 401 }));

    await createStoreSessionPort(seededStore()).refreshAccessToken();

    const init = fetchSpy.mock.calls[0]?.[1];
    expect(init?.body).toBeUndefined();
  });

  it("exchanges the cookie and writes the new access token and user to the store", async () => {
    const store = seededStore();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "mock-refreshed-token",
          expiresIn: 900,
          user: { id: "1", email: "test@example.com", role: "user" },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const port = createStoreSessionPort(store);

    await expect(port.refreshAccessToken()).resolves.toBe("mock-refreshed-token");
    expect(store.getState().auth.token).toBe("mock-refreshed-token");
    // Installed from the response, so a 401 raced against the boot restore —
    // which renews with nothing in memory — still ends up with a user.
    expect(store.getState().auth.user).toEqual({
      id: "1",
      email: "test@example.com",
      role: "user",
    });
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

    expect(store.getState().auth).toMatchObject({
      token: null,
      user: null,
      status: "anonymous",
    });
  });
});
