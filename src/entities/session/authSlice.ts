import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type UserRole = "admin" | "editor" | "user";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

/**
 * Where the session is in its lifecycle.
 *
 * This type exists because the access token stopped being persisted. While it
 * lived in `localStorage`, "is there a token in state?" was answerable
 * synchronously on the first render of the first paint, so two states were
 * enough: a token meant a session and no token meant no session. Now a reload
 * starts with no token *and* no answer — the refresh cookie is `HttpOnly`, so
 * the only way to learn whether a session exists is to ask the server, which
 * takes a round trip.
 *
 * Collapsing that third state back into "no token" is the one change that would
 * make this worse than what it replaced: every protected route would redirect
 * to `/login` on every reload, and the user would be bounced out of the
 * application a few hundred milliseconds before the session they still have
 * finishes being restored. See `docs/token-storage.md`.
 *
 * - `anonymous` — nobody is signed in, and nothing is in flight that might
 *   change that. The initial state, because a store with no restore running
 *   against it genuinely has no pending answer.
 * - `restoring` — a refresh is in flight and the outcome is unknown. Entered
 *   only by {@link sessionRestoreStarted}, i.e. only by code that is actually
 *   doing the asking.
 * - `authenticated` — there is an access token in memory.
 */
export type AuthStatus = "anonymous" | "restoring" | "authenticated";

/**
 * The session, in memory, for the lifetime of the document.
 *
 * `refreshToken` is deliberately absent from this type rather than merely
 * unused. The refresh token now lives in an `HttpOnly` cookie that JavaScript
 * cannot read, so there is no value for a field to hold — and making the field
 * unrepresentable is what stops it coming back. A reducer that wanted to stash
 * one would have to widen this interface, which is a change a reviewer reads as
 * one, where an unused-but-present field is re-populated by a one-line diff
 * nobody looks twice at.
 */
export interface AuthState {
  token: string | null;
  expiresAt: number | null;
  user: AuthUser | null;
  status: AuthStatus;
}

/**
 * Nothing is read from storage here, and that is the entire point of the item.
 *
 * The previous version of this module ran a `loadInitialState()` that read four
 * `localStorage` keys at module-evaluation time. Three things were wrong with
 * it, in increasing order of severity: it coupled store construction to a
 * global side effect, it made the initial state untestable without a storage
 * fixture, and it kept a long-lived refresh token in a place every script on
 * the origin can read — which is the whole of the XSS impact for this
 * application, since an attacker who can run one line of JavaScript can
 * exfiltrate a credential that outlives the page, the tab and the browser
 * session.
 */
const initialState: AuthState = {
  token: null,
  expiresAt: null,
  user: null,
  status: "anonymous",
};

export interface SetCredentialsPayload {
  token: string;
  expiresIn: number;
  user: AuthUser;
}

export interface RefreshAccessTokenPayload {
  token: string;
  expiresIn: number;
}

export const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    /**
     * A session has begun, or been re-established from the refresh cookie.
     *
     * Carries the user because the two callers that establish a session either
     * have one to hand (login, OAuth exchange) or have just been given one by
     * `POST /auth/refresh` (the boot restore, which by definition has nothing
     * in memory to fall back on).
     */
    setCredentials(state, action: PayloadAction<SetCredentialsPayload>) {
      const { token, expiresIn, user } = action.payload;
      state.token = token;
      state.expiresAt = Date.now() + expiresIn * 1000;
      state.user = user;
      state.status = "authenticated";
    },

    /**
     * A live session's access token has been renewed.
     *
     * Distinct from {@link setCredentials} by what it does *not* carry: the
     * user is already in memory, so a mid-session renewal that re-sent it would
     * invite the caller to pass a stale copy read from somewhere else.
     */
    refreshAccessToken(state, action: PayloadAction<RefreshAccessTokenPayload>) {
      const { token, expiresIn } = action.payload;
      state.token = token;
      state.expiresAt = Date.now() + expiresIn * 1000;
      state.status = "authenticated";
    },

    /**
     * A restore attempt is in flight; the answer is not known yet.
     *
     * Owned by the restore itself rather than baked into `initialState`, so
     * that `restoring` is only ever true while something is genuinely asking.
     * A store nobody is restoring reads `anonymous`, which keeps the state
     * honest for every unit test that builds one — and keeps the application
     * from showing a spinner in the case where there is nothing to wait for.
     */
    sessionRestoreStarted(state) {
      state.status = "restoring";
    },

    /**
     * The session is over: signed out, expired, or never existed.
     *
     * Also the failure branch of the boot restore. A restore that comes back
     * 401 has established exactly what a logout establishes — there is no
     * session — so it needs no action of its own.
     */
    logout(state) {
      state.token = null;
      state.expiresAt = null;
      state.user = null;
      state.status = "anonymous";
    },
  },
});

export const { setCredentials, refreshAccessToken, sessionRestoreStarted, logout } =
  authSlice.actions;
