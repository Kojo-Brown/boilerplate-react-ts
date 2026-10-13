import type { AppStore } from "@/app/store";
import { env } from "@/shared/config/env";
import { setCredentials, sessionRestoreStarted, logout } from "@/entities/session/authSlice";
import type { AuthUser } from "@/entities/session/authSlice";

/** A successful `POST /auth/refresh`. See `docs/token-storage.md`. */
interface RefreshResponse {
  token: string;
  expiresIn: number;
  user: AuthUser;
}

/**
 * What a reload costs now that the access token is not persisted.
 *
 * With tokens in `localStorage`, a reload restored the session by reading four
 * keys synchronously — no network, no intermediate state, and a refresh token
 * readable by any script on the origin. Without them, the only durable part of
 * the session is the `HttpOnly` refresh cookie, which JavaScript cannot read.
 * So the restore is a request: ask `POST /auth/refresh` whether the cookie
 * attached to it is still good, and take the access token it answers with.
 *
 * Three things about the shape of this function are deliberate.
 *
 * **It dispatches `sessionRestoreStarted()` synchronously**, before the first
 * `await`. `main.tsx` calls this at module scope and React renders later, so
 * the status is already `restoring` by the first paint and no protected route
 * ever sees the `anonymous` state that would bounce the user to `/login`. An
 * `async` function body runs synchronously up to its first `await`, which is
 * what makes "before the first paint" true without the caller awaiting
 * anything.
 *
 * **It is not awaited by the caller and never rejects.** A failed restore is
 * an ordinary outcome — most visitors are not signed in — so the absence of a
 * session is reported as state, not as an exception. Rejecting would make a
 * logged-out first visit an unhandled rejection in the console of every such
 * visit.
 *
 * **It uses a bare `fetch` rather than the `ApiClient`.** The client's 401
 * handler calls `SessionPort.refreshAccessToken()`, so routing the refresh
 * through the client would recurse on exactly the response an expired session
 * is most likely to get. `app/api/storeSession.ts` makes the same call for the
 * same reason, and that duplication is cheaper than the cycle.
 *
 * `credentials: "include"` is the line that makes any of this work: the whole
 * request is pointless without the cookie, and the application is served from
 * a different origin than the API in every environment, so the browser omits
 * the cookie unless asked.
 */
export async function restoreSession(store: AppStore): Promise<void> {
  store.dispatch(sessionRestoreStarted());

  try {
    const res = await fetch(`${env.VITE_API_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      store.dispatch(logout());
      return;
    }

    const data = (await res.json()) as RefreshResponse;
    store.dispatch(
      setCredentials({ token: data.token, expiresIn: data.expiresIn, user: data.user }),
    );
  } catch {
    // A transport failure is indistinguishable from a rejected cookie as far as
    // the user is concerned: either way there is no access token, so the
    // application must render as signed out. Reporting it as an error would
    // page somebody every time a visitor loads the login page offline.
    store.dispatch(logout());
  }
}
