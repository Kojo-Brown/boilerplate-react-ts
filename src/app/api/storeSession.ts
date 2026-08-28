import type { SessionPort } from "@/shared/api/apiClient";
import type { AppStore } from "@/app/store";
import { env } from "@/shared/config/env";
import { logout, refreshAccessToken } from "@/entities/session/authSlice";

/** Shape of a successful `POST /auth/refresh`. */
interface RefreshResponse {
  token: string;
  expiresIn: number;
}

/**
 * The Redux-backed {@link SessionPort}.
 *
 * This is the adapter half of the inversion, and the only module in the
 * codebase that knows both "there is an HTTP client" and "there is a Redux
 * store". It lives in `app/` because that is where the store singleton is
 * legal; everything below `app/` sees a `SessionPort` and cannot tell Redux is
 * behind it.
 *
 * The refresh request is made with a bare `fetch` rather than through an
 * `ApiClient`, on purpose: a client whose 401 handler called back into a client
 * would recurse on the one response an expired session is most likely to get.
 */
export function createStoreSessionPort(store: AppStore): SessionPort {
  return {
    getAccessToken: () => store.getState().auth.token,

    async refreshAccessToken() {
      const { refreshToken } = store.getState().auth;
      if (refreshToken === null) return null;

      const res = await fetch(`${env.VITE_API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;

      const data = (await res.json()) as RefreshResponse;
      store.dispatch(refreshAccessToken({ token: data.token, expiresIn: data.expiresIn }));
      return data.token;
    },

    onSessionExpired() {
      store.dispatch(logout());
    },
  };
}
