import type { AppStore } from "@/app/store";
import { authApi } from "@/features/auth/authApi";

const REFRESH_BUFFER_MS = 60_000;

let timerId: ReturnType<typeof setTimeout> | null = null;
let storeUnsubscribe: (() => void) | null = null;

function clearTimer(): void {
  if (timerId !== null) {
    clearTimeout(timerId);
    timerId = null;
  }
}

function scheduleRefresh(store: AppStore, expiresAt: number): void {
  clearTimer();

  const delay = Math.max(0, expiresAt - Date.now() - REFRESH_BUFFER_MS);

  timerId = setTimeout(() => {
    timerId = null;
    /*
      Gated on there being a live access token rather than on a refresh token,
      which no longer exists in store state — the credential is in an `HttpOnly`
      cookie the browser attaches and this code cannot see. `token` is the right
      stand-in: the timer was scheduled from an `expiresAt` that only a live
      session sets, and a `logout()` between scheduling and firing clears both.

      The check still earns its place. `scheduleRefresh` can be called with a
      delay of 0 for a token that is already near expiry, so the callback can
      land in the same task queue as a logout dispatched from elsewhere, and a
      refresh fired after sign-out would re-authenticate a user who just left.
    */
    const { token } = store.getState().auth;
    if (token === null) return;

    void store.dispatch(authApi.endpoints.refresh.initiate());
  }, delay);
}

export function startSilentRefresh(store: AppStore): () => void {
  if (storeUnsubscribe) {
    storeUnsubscribe();
    storeUnsubscribe = null;
  }

  const { expiresAt } = store.getState().auth;
  if (expiresAt) scheduleRefresh(store, expiresAt);

  let prevExpiresAt = expiresAt;

  storeUnsubscribe = store.subscribe(() => {
    const nextExpiresAt = store.getState().auth.expiresAt;
    if (nextExpiresAt === prevExpiresAt) return;
    prevExpiresAt = nextExpiresAt;
    if (nextExpiresAt) {
      scheduleRefresh(store, nextExpiresAt);
    } else {
      clearTimer();
    }
  });

  return () => {
    clearTimer();
    storeUnsubscribe?.();
    storeUnsubscribe = null;
  };
}

export function stopSilentRefresh(): void {
  clearTimer();
  storeUnsubscribe?.();
  storeUnsubscribe = null;
}
