import { describe, it, expect, beforeEach } from "vitest";
import {
  authSlice,
  setCredentials,
  refreshAccessToken,
  logout,
  AUTH_STORAGE_KEYS,
} from "./authSlice";

const { reducer } = authSlice;

const mockUser = { id: "1", email: "test@example.com", role: "user" };
const mockToken = "mock-access-token";
const mockRefreshToken = "mock-refresh-token";
const mockExpiresIn = 900;

describe("authSlice", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null fields as initial state when storage is empty", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.token).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.expiresAt).toBeNull();
    expect(state.user).toBeNull();
  });

  it("setCredentials stores token, refreshToken, expiresAt, and user", () => {
    const state = reducer(
      undefined,
      setCredentials({
        token: mockToken,
        refreshToken: mockRefreshToken,
        expiresIn: mockExpiresIn,
        user: mockUser,
      }),
    );
    expect(state.token).toBe(mockToken);
    expect(state.refreshToken).toBe(mockRefreshToken);
    expect(state.expiresAt).toBeGreaterThan(Date.now());
    expect(state.user).toEqual(mockUser);
  });

  it("setCredentials sets expiresAt to now + expiresIn seconds", () => {
    const before = Date.now();
    const state = reducer(
      undefined,
      setCredentials({
        token: mockToken,
        refreshToken: mockRefreshToken,
        expiresIn: mockExpiresIn,
        user: mockUser,
      }),
    );
    const after = Date.now();
    expect(state.expiresAt).toBeGreaterThanOrEqual(before + mockExpiresIn * 1000);
    expect(state.expiresAt).toBeLessThanOrEqual(after + mockExpiresIn * 1000);
  });

  it("setCredentials persists all fields to localStorage", () => {
    reducer(
      undefined,
      setCredentials({
        token: mockToken,
        refreshToken: mockRefreshToken,
        expiresIn: mockExpiresIn,
        user: mockUser,
      }),
    );
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN)).toBe(mockToken);
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN)).toBe(mockRefreshToken);
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.EXPIRES_AT)).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(AUTH_STORAGE_KEYS.USER) ?? "null")).toEqual(mockUser);
  });

  it("refreshAccessToken updates token and expiresAt without changing refreshToken or user", () => {
    const base = reducer(
      undefined,
      setCredentials({
        token: mockToken,
        refreshToken: mockRefreshToken,
        expiresIn: mockExpiresIn,
        user: mockUser,
      }),
    );
    const refreshed = reducer(base, refreshAccessToken({ token: "new-access-token", expiresIn: 900 }));
    expect(refreshed.token).toBe("new-access-token");
    expect(refreshed.refreshToken).toBe(mockRefreshToken);
    expect(refreshed.user).toEqual(mockUser);
    expect(refreshed.expiresAt).toBeGreaterThan(Date.now());
  });

  it("refreshAccessToken updates localStorage access token", () => {
    const base = reducer(
      undefined,
      setCredentials({
        token: mockToken,
        refreshToken: mockRefreshToken,
        expiresIn: mockExpiresIn,
        user: mockUser,
      }),
    );
    reducer(base, refreshAccessToken({ token: "new-access-token", expiresIn: 900 }));
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN)).toBe("new-access-token");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN)).toBe(mockRefreshToken);
  });

  it("logout clears all auth fields from state", () => {
    const loggedIn = reducer(
      undefined,
      setCredentials({
        token: mockToken,
        refreshToken: mockRefreshToken,
        expiresIn: mockExpiresIn,
        user: mockUser,
      }),
    );
    const loggedOut = reducer(loggedIn, logout());
    expect(loggedOut.token).toBeNull();
    expect(loggedOut.refreshToken).toBeNull();
    expect(loggedOut.expiresAt).toBeNull();
    expect(loggedOut.user).toBeNull();
  });

  it("logout removes all auth keys from localStorage", () => {
    const withCreds = reducer(
      undefined,
      setCredentials({
        token: mockToken,
        refreshToken: mockRefreshToken,
        expiresIn: mockExpiresIn,
        user: mockUser,
      }),
    );
    reducer(withCreds, logout());
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.EXPIRES_AT)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.USER)).toBeNull();
  });
});
