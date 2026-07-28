import { baseApi } from "@/store/api";
import { setCredentials, refreshAccessToken, logout, type AuthUser } from "@/store/authSlice";

interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

export interface RefreshResponse {
  token: string;
  expiresIn: number;
}

export interface GoogleExchangeRequest {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export const authApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    login: builder.mutation<LoginResponse, LoginRequest>({
      query: (credentials) => ({
        url: "/auth/login",
        method: "POST",
        body: credentials,
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

    refresh: builder.mutation<RefreshResponse, string>({
      query: (refreshToken) => ({
        url: "/auth/refresh",
        method: "POST",
        body: { refreshToken },
      }),
      async onQueryStarted(_, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(refreshAccessToken(data));
        } catch {
          // A failed refresh is handled by the caller; the silent-refresh loop
          // stops on error rather than retrying here.
        }
      },
    }),

    logoutUser: builder.mutation<void, void>({
      query: () => ({
        url: "/auth/logout",
        method: "POST",
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
