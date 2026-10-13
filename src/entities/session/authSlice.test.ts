import { describe, it, expect, beforeEach } from "vitest";
import {
  authSlice,
  setCredentials,
  refreshAccessToken,
  sessionRestoreStarted,
  logout,
  type AuthState,
  type AuthUser,
} from "@/entities/session/authSlice";
import { appStorageKeys } from "@/test/localStorage";

const { reducer } = authSlice;

const mockUser: AuthUser = { id: "1", email: "test@example.com", role: "user" };
const mockToken = "mock-access-token";
const mockExpiresIn = 900;

/** A signed-in state, as `setCredentials` produces one. */
function signedIn(): AuthState {
  return reducer(
    undefined,
    setCredentials({ token: mockToken, expiresIn: mockExpiresIn, user: mockUser }),
  );
}

describe("authSlice", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  describe("initial state", () => {
    it("is anonymous with no token, expiry or user", () => {
      const state = reducer(undefined, { type: "@@INIT" });
      expect(state).toEqual({
        token: null,
        expiresAt: null,
        user: null,
        status: "anonymous",
      });
    });

    /*
      The regression test for the whole item.

      The previous `initialState` was the return value of a `loadInitialState()`
      that read four `localStorage` keys at module-evaluation time, so a store
      built in a browser where those keys existed came up signed in. That is
      what made the refresh token worth stealing: it had to be durable, so it
      had to be somewhere an XSS payload could read.

      Written as "a populated storage changes nothing" rather than "the keys are
      absent", because the first fails if anyone re-adds a read under any key
      and the second only fails for the four names that used to be there.
    */
    it("ignores a session sitting in localStorage", () => {
      localStorage.setItem("auth.accessToken", "stolen-token");
      localStorage.setItem("auth.refreshToken", "stolen-refresh-token");
      localStorage.setItem("auth.expiresAt", JSON.stringify(Date.now() + 900_000));
      localStorage.setItem("auth.user", JSON.stringify(mockUser));

      const state = reducer(undefined, { type: "@@INIT" });

      expect(state.token).toBeNull();
      expect(state.user).toBeNull();
      expect(state.status).toBe("anonymous");
    });

    it("has no refreshToken field at all", () => {
      // The field is gone from `AuthState`, not merely left null — a reducer
      // cannot stash one without widening the interface. `toEqual` above pins
      // the exact shape; this names the intent.
      const state = reducer(undefined, { type: "@@INIT" });
      expect(Object.keys(state).sort()).toEqual(["expiresAt", "status", "token", "user"]);
    });
  });

  describe("setCredentials", () => {
    it("stores the token, expiry and user, and marks the session authenticated", () => {
      const state = signedIn();
      expect(state.token).toBe(mockToken);
      expect(state.user).toEqual(mockUser);
      expect(state.expiresAt).toBeGreaterThan(Date.now());
      expect(state.status).toBe("authenticated");
    });

    it("sets expiresAt to now + expiresIn seconds", () => {
      const before = Date.now();
      const state = signedIn();
      const after = Date.now();
      expect(state.expiresAt).toBeGreaterThanOrEqual(before + mockExpiresIn * 1000);
      expect(state.expiresAt).toBeLessThanOrEqual(after + mockExpiresIn * 1000);
    });

    it("writes nothing to localStorage or sessionStorage", () => {
      signedIn();
      expect(appStorageKeys(localStorage)).toEqual([]);
      expect(appStorageKeys(sessionStorage)).toEqual([]);
    });

    it("promotes a restoring session straight to authenticated", () => {
      const restoring = reducer(undefined, sessionRestoreStarted());
      const state = reducer(
        restoring,
        setCredentials({ token: mockToken, expiresIn: mockExpiresIn, user: mockUser }),
      );
      expect(state.status).toBe("authenticated");
    });
  });

  describe("refreshAccessToken", () => {
    it("updates the token and expiry while leaving the user alone", () => {
      const refreshed = reducer(
        signedIn(),
        refreshAccessToken({ token: "new-access-token", expiresIn: 900 }),
      );
      expect(refreshed.token).toBe("new-access-token");
      expect(refreshed.user).toEqual(mockUser);
      expect(refreshed.expiresAt).toBeGreaterThan(Date.now());
      expect(refreshed.status).toBe("authenticated");
    });

    it("writes nothing to storage", () => {
      reducer(signedIn(), refreshAccessToken({ token: "new-access-token", expiresIn: 900 }));
      expect(appStorageKeys(localStorage)).toEqual([]);
      expect(appStorageKeys(sessionStorage)).toEqual([]);
    });
  });

  describe("sessionRestoreStarted", () => {
    it("moves an anonymous store to restoring without inventing a session", () => {
      const state = reducer(undefined, sessionRestoreStarted());
      expect(state.status).toBe("restoring");
      expect(state.token).toBeNull();
      expect(state.user).toBeNull();
    });

    it("is not the initial state, so a store nobody is restoring reads anonymous", () => {
      // The distinction `ProtectedRoute` depends on: `restoring` is only true
      // while something is genuinely asking the server, so a cold visit to a
      // protected URL redirects on the first render instead of hanging on a
      // spinner that nothing will ever resolve.
      expect(reducer(undefined, { type: "@@INIT" }).status).toBe("anonymous");
    });
  });

  describe("logout", () => {
    it("clears every auth field and marks the session anonymous", () => {
      const loggedOut = reducer(signedIn(), logout());
      expect(loggedOut).toEqual({
        token: null,
        expiresAt: null,
        user: null,
        status: "anonymous",
      });
    });

    it("resolves a restore that found no session", () => {
      // The failure branch of the boot restore. It needs no action of its own:
      // "there is no session" is exactly what logout establishes.
      const restoring = reducer(undefined, sessionRestoreStarted());
      expect(reducer(restoring, logout()).status).toBe("anonymous");
    });

    it("leaves storage untouched, because nothing was ever put there", () => {
      // Not a no-op assertion: the previous `logout` removed four keys, which
      // means it knew about four keys, which means something wrote them.
      localStorage.setItem("theme", "dark");
      reducer(signedIn(), logout());
      expect(appStorageKeys(localStorage)).toEqual(["theme"]);
    });
  });
});
