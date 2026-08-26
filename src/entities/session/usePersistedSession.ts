import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/shared/store/hooks";
import { logout } from "@/entities/session/authSlice";
import { isSessionExpired } from "@/entities/session/persistedSession";

const EXPIRY_CHECK_INTERVAL_MS = 60_000;

export function usePersistedSession(): void {
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
