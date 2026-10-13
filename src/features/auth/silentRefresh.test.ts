import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/shared/mocks/server";
import { makeStore } from "@/test/renderWithProviders";
import { setCredentials, logout, type AuthUser } from "@/entities/session/authSlice";
import { startSilentRefresh, stopSilentRefresh } from "@/features/auth/silentRefresh";

const API = "http://localhost:4000";
const mockUser: AuthUser = { id: "1", email: "test@example.com", role: "user" };

/**
 * What the refresh request is allowed to carry.
 *
 * Deliberately a type with no members: the endpoint used to take the refresh
 * token in its body, and the contract now is that it takes nothing, because the
 * credential travels in an `HttpOnly` cookie the browser attaches. The assertion
 * below reads the body back and checks it holds no token — a body is the one
 * place a regression would put one, and it would be invisible to a test that
 * only checked the request was made.
 */
type RefreshRequestBody = Record<string, unknown>;

describe("silentRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopSilentRefresh();
    vi.useRealTimers();
  });

  it("does not schedule a refresh timer when there is no token in memory", async () => {
    const store = makeStore();
    const refreshCalled = vi.fn();
    server.use(
      http.post(`${API}/auth/refresh`, () => {
        refreshCalled();
        return HttpResponse.json({ token: "t", expiresIn: 900, user: mockUser });
      }),
    );

    startSilentRefresh(store);
    await vi.advanceTimersByTimeAsync(600_000);

    expect(refreshCalled).not.toHaveBeenCalled();
  });

  it("fires the refresh endpoint approximately 1 minute before token expiry", async () => {
    const store = makeStore();
    store.dispatch(setCredentials({ token: "tok", expiresIn: 120, user: mockUser }));

    // Held in an object rather than a bare `let`: TypeScript's control-flow
    // analysis cannot see the assignment inside the async handler and would
    // narrow a `let` to `null` for the rest of the test.
    const captured: { body: RefreshRequestBody | null; credentials: RequestCredentials | null } = {
      body: null,
      credentials: null,
    };
    server.use(
      http.post(`${API}/auth/refresh`, async ({ request }) => {
        captured.credentials = request.credentials;
        const text = await request.text();
        captured.body = text === "" ? {} : (JSON.parse(text) as RefreshRequestBody);
        return HttpResponse.json({ token: "new-tok", expiresIn: 900, user: mockUser });
      }),
    );

    startSilentRefresh(store);

    // Not yet in the 60s buffer window — should not have fired
    await vi.advanceTimersByTimeAsync(59_000);
    expect(captured.body).toBeNull();

    // Now past the buffer (60s elapsed, 60s until expiry — within buffer)
    await vi.advanceTimersByTimeAsync(2_000);

    // Allow the async dispatch chain to settle
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(captured.body).not.toBeNull();
    // The credential is not in the body, because it is not in JavaScript at all.
    expect(captured.body).not.toHaveProperty("refreshToken");
    // And the request is the kind that carries a cookie. Without this the
    // browser omits it cross-origin and every refresh 401s — a failure no
    // assertion about the body would notice.
    expect(captured.credentials).toBe("include");
  });

  it("updates the Redux access token after the silent refresh completes", async () => {
    const store = makeStore();
    store.dispatch(setCredentials({ token: "old-tok", expiresIn: 120, user: mockUser }));

    server.use(
      http.post(`${API}/auth/refresh`, () =>
        HttpResponse.json({ token: "refreshed-tok", expiresIn: 900, user: mockUser }),
      ),
    );

    startSilentRefresh(store);

    await vi.advanceTimersByTimeAsync(65_000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(store.getState().auth.token).toBe("refreshed-tok");
  });

  it("clears the refresh timer when the user logs out", async () => {
    const store = makeStore();
    store.dispatch(setCredentials({ token: "tok", expiresIn: 120, user: mockUser }));

    const refreshCalled = vi.fn();
    server.use(
      http.post(`${API}/auth/refresh`, () => {
        refreshCalled();
        return HttpResponse.json({ token: "new", expiresIn: 900, user: mockUser });
      }),
    );

    startSilentRefresh(store);
    store.dispatch(logout());

    await vi.advanceTimersByTimeAsync(200_000);

    expect(refreshCalled).not.toHaveBeenCalled();
  });

  it("reschedules the timer after a successful token refresh", async () => {
    const store = makeStore();
    store.dispatch(setCredentials({ token: "tok", expiresIn: 120, user: mockUser }));

    let callCount = 0;
    server.use(
      http.post(`${API}/auth/refresh`, () => {
        callCount++;
        return HttpResponse.json({ token: `tok-${callCount}`, expiresIn: 120 });
      }),
    );

    startSilentRefresh(store);

    // Fire the first refresh
    await vi.advanceTimersByTimeAsync(65_000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(callCount).toBe(1);

    // Advance again to trigger the re-scheduled refresh
    await vi.advanceTimersByTimeAsync(65_000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(callCount).toBe(2);
  });

  it("stopSilentRefresh cancels a pending refresh timer", async () => {
    const store = makeStore();
    store.dispatch(setCredentials({ token: "tok", expiresIn: 120, user: mockUser }));

    const refreshCalled = vi.fn();
    server.use(
      http.post(`${API}/auth/refresh`, () => {
        refreshCalled();
        return HttpResponse.json({ token: "new", expiresIn: 900, user: mockUser });
      }),
    );

    startSilentRefresh(store);
    stopSilentRefresh();

    await vi.advanceTimersByTimeAsync(200_000);

    expect(refreshCalled).not.toHaveBeenCalled();
  });
});
