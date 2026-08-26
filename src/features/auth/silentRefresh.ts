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
    const { refreshToken } = store.getState().auth;
    if (!refreshToken) return;

    void store.dispatch(authApi.endpoints.refresh.initiate(refreshToken));
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
