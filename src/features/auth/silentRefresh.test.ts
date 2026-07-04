import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { makeStore } from "@/test/renderWithProviders";
import { setCredentials, logout } from "@/store/authSlice";
import { startSilentRefresh, stopSilentRefresh } from "./silentRefresh";

const API = "http://localhost:4000";
const mockUser = { id: "1", email: "test@example.com", role: "user" };

describe("silentRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    stopSilentRefresh();
    vi.useRealTimers();
  });

  it("does not schedule a refresh timer when there is no stored token", async () => {
    const store = makeStore();
    const refreshCalled = vi.fn();
    server.use(http.post(`${API}/auth/refresh`, () => { refreshCalled(); return HttpResponse.json({ token: "t", expiresIn: 900 }); }));

    startSilentRefresh(store);
    await vi.advanceTimersByTimeAsync(600_000);

    expect(refreshCalled).not.toHaveBeenCalled();
  });

  it("fires the refresh endpoint approximately 1 minute before token expiry", async () => {
    const store = makeStore();
    store.dispatch(
      setCredentials({ token: "tok", refreshToken: "ref-tok", expiresIn: 120, user: mockUser }),
    );

    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post(`${API}/auth/refresh`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ token: "new-tok", expiresIn: 900 });
      }),
    );

    startSilentRefresh(store);

    // Not yet in the 60s buffer window — should not have fired
    await vi.advanceTimersByTimeAsync(59_000);
    expect(capturedBody).toBeNull();

    // Now past the buffer (60s elapsed, 60s until expiry — within buffer)
    await vi.advanceTimersByTimeAsync(2_000);

    // Allow the async dispatch chain to settle
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(capturedBody).not.toBeNull();
    expect(capturedBody?.refreshToken).toBe("ref-tok");
  });

  it("updates the Redux access token after the silent refresh completes", async () => {
    const store = makeStore();
    store.dispatch(
      setCredentials({ token: "old-tok", refreshToken: "ref-tok", expiresIn: 120, user: mockUser }),
    );

    server.use(
      http.post(`${API}/auth/refresh`, () =>
        HttpResponse.json({ token: "refreshed-tok", expiresIn: 900 }),
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
    store.dispatch(
      setCredentials({ token: "tok", refreshToken: "ref", expiresIn: 120, user: mockUser }),
    );

    const refreshCalled = vi.fn();
    server.use(
      http.post(`${API}/auth/refresh`, () => {
        refreshCalled();
        return HttpResponse.json({ token: "new", expiresIn: 900 });
      }),
    );

    startSilentRefresh(store);
    store.dispatch(logout());

    await vi.advanceTimersByTimeAsync(200_000);

    expect(refreshCalled).not.toHaveBeenCalled();
  });

  it("reschedules the timer after a successful token refresh", async () => {
    const store = makeStore();
    store.dispatch(
      setCredentials({ token: "tok", refreshToken: "ref", expiresIn: 120, user: mockUser }),
    );

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
    store.dispatch(
      setCredentials({ token: "tok", refreshToken: "ref", expiresIn: 120, user: mockUser }),
    );

    const refreshCalled = vi.fn();
    server.use(http.post(`${API}/auth/refresh`, () => { refreshCalled(); return HttpResponse.json({ token: "new", expiresIn: 900 }); }));

    startSilentRefresh(store);
    stopSilentRefresh();

    await vi.advanceTimersByTimeAsync(200_000);

    expect(refreshCalled).not.toHaveBeenCalled();
  });
});
