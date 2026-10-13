import { baseApi } from "@/shared/api/baseApi";
import {
  setCredentials,
  refreshAccessToken,
  logout,
  type AuthUser,
} from "@/entities/session/authSlice";

interface LoginRequest {
  email: string;
  password: string;
}

/**
 * A successful login.
 *
 * `refreshToken` is gone from this type, and its absence is the contract
 * change: the server now returns the refresh token as a `Set-Cookie` header
 * with `HttpOnly`, so there is no field for it because there is nothing the
 * client is allowed to see. A server that kept sending one in the body would
 * be handing back the credential this change exists to hide.
 */
export interface LoginResponse {
  token: string;
  expiresIn: number;
  user: AuthUser;
}

/**
 * A successful refresh.
 *
 * Carries the user, unlike the response it replaces. The boot restore in
 * `restoreSession.ts` calls this endpoint with nothing in memory at all, so a
 * response of `{ token, expiresIn }` alone would re-authenticate a session
 * with no idea who it belongs to. Returning the user also means a role change
 * takes effect at the next renewal rather than at the next sign-in.
 */
export interface RefreshResponse {
  token: string;
  expiresIn: number;
  user: AuthUser;
}

export interface GoogleExchangeRequest {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

/**
 * Sent only by the endpoints below, and deliberately not by `baseApi` as a
 * whole.
 *
 * `credentials: "include"` attaches the refresh cookie to a cross-origin
 * request. Setting it on the shared `fetchBaseQuery` would have been one line
 * and would have attached it to `/posts`, `/feed` and every endpoint added
 * later — sending a long-lived credential to routes that have no use for it,
 * which is the habit this item is about breaking. The cookie is also scoped
 * `Path=/auth` by the server, so the two halves agree: the client asks for it
 * where it is needed and the browser would withhold it anywhere else.
 */
const WITH_REFRESH_COOKIE = { credentials: "include" } as const;

export const authApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    login: builder.mutation<LoginResponse, LoginRequest>({
      query: (credentials) => ({
        url: "/auth/login",
        method: "POST",
        body: credentials,
        ...WITH_REFRESH_COOKIE,
      }),
      async onQueryStarted(_, { dispatch, queryFulfilled }) {
        // `queryFulfilled` rejects on any failed request. Awaiting it without a
        // catch leaves an unhandled rejection on every bad login — the error is
        // already surfaced to callers through the hook's `isError` state.
        try {
          const { data } = await queryFulfilled;
          dispatch(setCredentials(data));
        } catch {
          // Handled by the caller via the mutation's error state.
        }
      },
    }),

    /**
     * Renews the access token using the refresh cookie.
     *
     * Takes `void` where it used to take the refresh token as its argument.
     * That signature change is the point: there is no longer a value a caller
     * could pass, so no call site can hold one, and the credential travels in a
     * header the browser writes and JavaScript cannot read.
     */
    refresh: builder.mutation<RefreshResponse, void>({
      query: () => ({
        url: "/auth/refresh",
        method: "POST",
        ...WITH_REFRESH_COOKIE,
      }),
      async onQueryStarted(_, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(refreshAccessToken({ token: data.token, expiresIn: data.expiresIn }));
        } catch {
          // A failed refresh is handled by the caller; the silent-refresh loop
          // stops on error rather than retrying here.
        }
      },
    }),

    logoutUser: builder.mutation<void, void>({
      // Needs the cookie as much as the refresh does: clearing the session
      // server-side means revoking *this* refresh token, and the request has
      // no other way to say which one it means.
      query: () => ({
        url: "/auth/logout",
        method: "POST",
        ...WITH_REFRESH_COOKIE,
      }),
      async onQueryStarted(_, { dispatch, queryFulfilled }) {
        // `finally` alone still lets the rejection propagate, so a failing
        // server-side logout became an unhandled rejection. Local auth state is
        // cleared either way: the user asked to log out.
        try {
          await queryFulfilled;
        } catch {
          // Server-side logout failed; clearing locally is still correct.
        }
        dispatch(logout());
      },
    }),

    googleExchange: builder.mutation<LoginResponse, GoogleExchangeRequest>({
      query: (body) => ({
        url: "/auth/google/callback",
        method: "POST",
        body,
        ...WITH_REFRESH_COOKIE,
      }),
      async onQueryStarted(_, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(setCredentials(data));
        } catch {
          // Handled by the caller via the mutation's error state.
        }
      },
    }),
  }),
  overrideExisting: false,
});

export const {
  useLoginMutation,
  useRefreshMutation,
  useLogoutUserMutation,
  useGoogleExchangeMutation,
} = authApi;
