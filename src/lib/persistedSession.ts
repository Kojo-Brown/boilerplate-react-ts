import type { AuthUser } from "@/store/authSlice";
import { AUTH_STORAGE_KEYS } from "@/store/authSlice";

export interface PersistedSession {
  token: string;
  refreshToken: string;
  expiresAt: number;
  user: AuthUser;
}

export function isSessionExpired(expiresAt: number): boolean {
  return Date.now() >= expiresAt;
}

export function clearPersistedSession(): void {
  (Object.values(AUTH_STORAGE_KEYS) as string[]).forEach((key) => {
    localStorage.removeItem(key);
  });
}

export function readPersistedSession(): PersistedSession | null {
  try {
    const token = localStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN);
    const refreshToken = localStorage.getItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN);
    const expiresAtRaw = localStorage.getItem(AUTH_STORAGE_KEYS.EXPIRES_AT);
    const userRaw = localStorage.getItem(AUTH_STORAGE_KEYS.USER);

    if (!token || !refreshToken || !expiresAtRaw || !userRaw) return null;

    const expiresAt = JSON.parse(expiresAtRaw) as unknown;
    if (typeof expiresAt !== "number") return null;

    if (isSessionExpired(expiresAt)) {
      clearPersistedSession();
      return null;
    }

    const user = JSON.parse(userRaw) as AuthUser;
    return { token, refreshToken, expiresAt, user };
  } catch {
    return null;
  }
}
