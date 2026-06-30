import { describe, it, expect, beforeEach } from "vitest";
import { authSlice, setCredentials, logout } from "./authSlice";

const { reducer } = authSlice;
const mockUser = { id: "1", email: "test@example.com", role: "user" };
const mockToken = "mock-jwt-token";

describe("authSlice", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null token and user as initial state", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
  });

  it("setCredentials sets token and user", () => {
    const state = reducer(undefined, setCredentials({ token: mockToken, user: mockUser }));
    expect(state.token).toBe(mockToken);
    expect(state.user).toEqual(mockUser);
  });

  it("setCredentials persists token to localStorage", () => {
    reducer(undefined, setCredentials({ token: mockToken, user: mockUser }));
    expect(localStorage.getItem("token")).toBe(mockToken);
  });

  it("logout clears token and user", () => {
    const loggedIn = reducer(undefined, setCredentials({ token: mockToken, user: mockUser }));
    const loggedOut = reducer(loggedIn, logout());
    expect(loggedOut.token).toBeNull();
    expect(loggedOut.user).toBeNull();
  });

  it("logout removes token from localStorage", () => {
    reducer(undefined, setCredentials({ token: mockToken, user: mockUser }));
    reducer(undefined, logout());
    expect(localStorage.getItem("token")).toBeNull();
  });
});
