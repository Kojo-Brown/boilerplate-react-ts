import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Provider } from "react-redux";
import type { ReactNode } from "react";
import { makeStore } from "@/test/renderWithProviders";
import { setCredentials } from "@/entities/session/authSlice";
import { AuthProvider, useAuth } from "@/features/auth/AuthContext";

function makeWrapper(store: ReturnType<typeof makeStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <Provider store={store}>
        <AuthProvider>{children}</AuthProvider>
      </Provider>
    );
  };
}

describe("useAuth", () => {
  it("throws when used outside AuthProvider", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow(
      "useAuth must be used within an AuthProvider",
    );
    consoleError.mockRestore();
  });

  it("returns isAuthenticated=false for unauthenticated state", () => {
    const store = makeStore();
    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper(store) });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
  });

  it("returns isAuthenticated=true after login", () => {
    const store = makeStore();
    store.dispatch(
      setCredentials({
        token: "tok-abc",
        refreshToken: "ref-tok",
        expiresIn: 900,
        user: { id: "1", email: "user@example.com", role: "user" },
      }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper(store) });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual({ id: "1", email: "user@example.com", role: "user" });
    expect(result.current.token).toBe("tok-abc");
  });

  it("hasRole returns true when user role matches", () => {
    const store = makeStore();
    store.dispatch(
      setCredentials({
        token: "tok",
        refreshToken: "ref",
        expiresIn: 900,
        user: { id: "1", email: "admin@example.com", role: "admin" },
      }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper(store) });
    expect(result.current.hasRole("admin")).toBe(true);
    expect(result.current.hasRole("user")).toBe(false);
    expect(result.current.hasRole("editor")).toBe(false);
  });

  it("hasRole returns false when not authenticated", () => {
    const store = makeStore();
    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper(store) });
    expect(result.current.hasRole("admin")).toBe(false);
    expect(result.current.hasRole("user")).toBe(false);
  });

  it("hasAnyRole returns true when any role in the list matches", () => {
    const store = makeStore();
    store.dispatch(
      setCredentials({
        token: "tok",
        refreshToken: "ref",
        expiresIn: 900,
        user: { id: "1", email: "editor@example.com", role: "editor" },
      }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper(store) });
    expect(result.current.hasAnyRole(["admin", "editor"])).toBe(true);
    expect(result.current.hasAnyRole(["admin", "user"])).toBe(false);
  });

  it("hasAnyRole returns false when not authenticated", () => {
    const store = makeStore();
    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper(store) });
    expect(result.current.hasAnyRole(["admin", "editor", "user"])).toBe(false);
  });

  it("signOut clears auth state", () => {
    const store = makeStore();
    store.dispatch(
      setCredentials({
        token: "tok",
        refreshToken: "ref",
        expiresIn: 900,
        user: { id: "1", email: "user@example.com", role: "user" },
      }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper(store) });

    act(() => {
      result.current.signOut();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
  });
});
