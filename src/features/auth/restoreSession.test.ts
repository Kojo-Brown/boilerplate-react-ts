import { describe, it, expect, vi, afterEach } from "vitest";
import { restoreSession } from "@/features/auth/restoreSession";
import { setCredentials, type AuthUser } from "@/entities/session/authSlice";
import { makeStore, type TestStore } from "@/test/renderWithProviders";
import { appStorageKeys } from "@/test/localStorage";
import { env } from "@/shared/config/env";

const REFRESH_URL = `${env.VITE_API_URL}/auth/refresh`;
const mockUser: AuthUser = { id: "1", email: "test@example.com", role: "user" };

function okResponse(token = "restored-token"): Response {
  return new Response(JSON.stringify({ token, expiresIn: 900, user: mockUser }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** A store with a session already in memory, as a mid-session call would see. */
function seededStore(): TestStore {
  const store = makeStore();
  store.dispatch(setCredentials({ token: "existing", expiresIn: 900, user: mockUser }));
  return store;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("restoreSession", () => {
  it("installs the token and user from a successful refresh", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
    const store = makeStore();

    await restoreSession(store);

    expect(store.getState().auth).toMatchObject({
      token: "restored-token",
      user: mockUser,
      status: "authenticated",
    });
    expect(store.getState().auth.expiresAt).toBeGreaterThan(Date.now());
  });

  /*
    The property `main.tsx` depends on, and the reason this is not an effect.

    `restoreSession` is called at module scope and never awaited, so the only
    thing standing between the first paint and a redirect to `/login` is that
    the status is already `restoring` by the time React renders. An `async`
    function body runs synchronously up to its first `await`, which is what
    makes that true — and it stops being true the moment somebody puts an
    `await` above the dispatch, which is a change this test fails on and
    nothing else would.
  */
  it("marks the store restoring synchronously, before the request settles", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => undefined));
    const store = makeStore();

    const pending = restoreSession(store);

    expect(store.getState().auth.status).toBe("restoring");
    expect(store.getState().auth.token).toBeNull();
    void pending;
  });

  it("asks with credentials, which is the only reason the cookie is sent", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());

    await restoreSession(makeStore());

    expect(fetchSpy).toHaveBeenCalledWith(
      REFRESH_URL,
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("sends no body, because there is no credential in JavaScript to send", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());

    await restoreSession(makeStore());

    expect(fetchSpy.mock.calls[0]?.[1]?.body).toBeUndefined();
  });

  it("ends as anonymous when the cookie is missing or rejected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));
    const store = makeStore();

    await restoreSession(store);

    expect(store.getState().auth.status).toBe("anonymous");
    expect(store.getState().auth.token).toBeNull();
  });

  it("ends as anonymous, and does not reject, when the request fails outright", async () => {
    // A signed-out visitor loading the application offline. Rejecting here
    // would be an unhandled rejection on every such visit, since nothing
    // awaits this.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const store = makeStore();

    await expect(restoreSession(store)).resolves.toBeUndefined();
    expect(store.getState().auth.status).toBe("anonymous");
  });

  it("ends as anonymous when the response is not JSON", async () => {
    // A proxy or captive portal answering 200 with an HTML error page. The
    // `json()` rejection lands in the same catch as a transport failure, and
    // must not leave the status stuck on `restoring` — which would hold every
    // protected route on a spinner forever.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>nope</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    const store = makeStore();

    await restoreSession(store);

    expect(store.getState().auth.status).toBe("anonymous");
  });

  it("clears a session already in memory when the refresh is rejected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));
    const store = seededStore();

    await restoreSession(store);

    expect(store.getState().auth.token).toBeNull();
    expect(store.getState().auth.user).toBeNull();
  });

  it("persists nothing, on either outcome", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
    await restoreSession(makeStore());
    expect(appStorageKeys(localStorage)).toEqual([]);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));
    await restoreSession(makeStore());
    expect(appStorageKeys(localStorage)).toEqual([]);
    expect(appStorageKeys(sessionStorage)).toEqual([]);
  });
});
