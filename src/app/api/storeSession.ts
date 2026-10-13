import type { SessionPort } from "@/shared/api/apiClient";
import type { AppStore } from "@/app/store";
import { env } from "@/shared/config/env";
import { logout, setCredentials } from "@/entities/session/authSlice";
import type { AuthUser } from "@/entities/session/authSlice";

/** Shape of a successful `POST /auth/refresh`. */
interface RefreshResponse {
  token: string;
  expiresIn: number;
  user: AuthUser;
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

    /**
     * Renews the access token from the refresh cookie.
     *
     * The guard this used to open with — `if (refreshToken === null) return
     * null` — is gone, because there is no longer a refresh token in store
     * state to read. Whether a renewable session exists is now a fact only the
     * server and the browser's cookie jar know between them, and the only way
     * to find out is to make the request and read the status. Losing the guard
     * costs one request per 401 on an anonymous session; keeping a client-side
     * mirror of "do I have a refresh token" would mean persisting the very
     * thing this change removed.
     *
     * `setCredentials` rather than `refreshAccessToken`: the response carries
     * the user, and a renewal that arrives while the store has none — a 401
     * raced against the boot restore — needs to install it.
     */
    async refreshAccessToken() {
      const res = await fetch(`${env.VITE_API_URL}/auth/refresh`, {
        method: "POST",
        // Without this the cookie is not attached and every refresh 401s. The
        // application and the API are separate origins in every environment.
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) return null;

      const data = (await res.json()) as RefreshResponse;
      store.dispatch(
        setCredentials({ token: data.token, expiresIn: data.expiresIn, user: data.user }),
      );
      return data.token;
    },

    onSessionExpired() {
      store.dispatch(logout());
    },
  };
}
