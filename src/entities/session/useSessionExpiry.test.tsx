import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Provider } from "react-redux";
import type { ReactNode } from "react";
import { makeStore } from "@/test/renderWithProviders";
import { setCredentials, logout } from "@/entities/session/authSlice";
import { useSessionExpiry } from "@/entities/session/useSessionExpiry";

function makeWrapper(store: ReturnType<typeof makeStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

const mockUser = { id: "1", email: "test@example.com", role: "user" as const };

describe("useSessionExpiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing when there is no session (expiresAt is null)", () => {
    const store = makeStore();
    renderHook(
      () => {
        useSessionExpiry();
      },
      { wrapper: makeWrapper(store) },
    );

    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    expect(store.getState().auth.token).toBeNull();
  });

  it("dispatches logout immediately when session is already expired on mount", () => {
    const store = makeStore();
    store.dispatch(
      setCredentials({
        token: "tok",
        expiresIn: 1,
        user: mockUser,
      }),
    );
    // Wind clock past expiry
    vi.setSystemTime(Date.now() + 2_000);

    renderHook(
      () => {
        useSessionExpiry();
      },
      { wrapper: makeWrapper(store) },
    );

    expect(store.getState().auth.token).toBeNull();
    expect(store.getState().auth.user).toBeNull();
  });

  it("dispatches logout when the interval fires after expiry", () => {
    const store = makeStore();
    store.dispatch(
      setCredentials({
        token: "tok",
        expiresIn: 90,
        user: mockUser,
      }),
    );

    renderHook(
      () => {
        useSessionExpiry();
      },
      { wrapper: makeWrapper(store) },
    );
    expect(store.getState().auth.token).toBe("tok");

    // Move time past expiry
    act(() => {
      vi.advanceTimersByTime(91_000);
    });
    // Trigger the interval
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(store.getState().auth.token).toBeNull();
  });

  it("does not dispatch logout while session is still valid", () => {
    const store = makeStore();
    store.dispatch(
      setCredentials({
        token: "tok",
        expiresIn: 900,
        user: mockUser,
      }),
    );

    const dispatchSpy = vi.spyOn(store, "dispatch");
    renderHook(
      () => {
        useSessionExpiry();
      },
      { wrapper: makeWrapper(store) },
    );

    act(() => {
      vi.advanceTimersByTime(600_000);
    });

    const logoutDispatched = dispatchSpy.mock.calls.some(
      (call) => (call[0] as { type?: string }).type === logout.type,
    );
    expect(logoutDispatched).toBe(false);
  });

  it("clears the interval on unmount", () => {
    const store = makeStore();
    store.dispatch(
      setCredentials({
        token: "tok",
        expiresIn: 900,
        user: mockUser,
      }),
    );

    const { unmount } = renderHook(
      () => {
        useSessionExpiry();
      },
      {
        wrapper: makeWrapper(store),
      },
    );

    unmount();

    // No errors should occur after unmount
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(store.getState().auth.token).toBe("tok");
  });
});
