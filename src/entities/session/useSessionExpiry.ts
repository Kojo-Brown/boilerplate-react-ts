import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/shared/store/hooks";
import { logout } from "@/entities/session/authSlice";
import { isSessionExpired } from "@/entities/session/sessionExpiry";

const EXPIRY_CHECK_INTERVAL_MS = 60_000;

/**
 * Ends the session once its access token's expiry has passed.
 *
 * Named `usePersistedSession` until the token stopped being persisted, which
 * made the old name describe the opposite of what the application now does.
 * Nothing about the behaviour changed with the rename: the hook never touched
 * storage, it watches `expiresAt` in memory.
 *
 * This is a backstop, not the mechanism. The access token is normally renewed
 * ahead of expiry by `startSilentRefresh`, and a request that races past it is
 * covered by the API client's 401-and-retry. What this catches is the case
 * neither of those can: a tab that was suspended — asleep, backgrounded on a
 * phone, a laptop lid closed — long enough for the timer to fire late, so the
 * session is already dead and no request has been made that would find out.
 * Clearing it locally means the next render shows a signed-out application
 * rather than a signed-in one whose every request 401s.
 */
export function useSessionExpiry(): void {
  const dispatch = useAppDispatch();
  const expiresAt = useAppSelector((state) => state.auth.expiresAt);

  useEffect(() => {
    if (expiresAt === null) return;

    if (isSessionExpired(expiresAt)) {
      dispatch(logout());
      return;
    }

    const interval = setInterval(() => {
      if (isSessionExpired(expiresAt)) {
        dispatch(logout());
      }
    }, EXPIRY_CHECK_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [dispatch, expiresAt]);
}
