import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { AUTH_STORAGE_KEYS } from "@/store/authSlice";
import {
  isSessionExpired,
  readPersistedSession,
  clearPersistedSession,
} from "./persistedSession";

const mockUser = { id: "1", email: "test@example.com", role: "user" as const };

function populateStorage(overrides: Partial<{
  token: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  user: typeof mockUser | null;
}> = {}): void {
  const defaults = {
    token: "access-token",
    refreshToken: "refresh-token",
    expiresAt: Date.now() + 900_000,
    user: mockUser,
  };
  const merged = { ...defaults, ...overrides };

  if (merged.token !== null)
    localStorage.setItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN, merged.token);
  if (merged.refreshToken !== null)
    localStorage.setItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN, merged.refreshToken);
  if (merged.expiresAt !== null)
    localStorage.setItem(AUTH_STORAGE_KEYS.EXPIRES_AT, JSON.stringify(merged.expiresAt));
  if (merged.user !== null)
    localStorage.setItem(AUTH_STORAGE_KEYS.USER, JSON.stringify(merged.user));
}

describe("isSessionExpired", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns false when expiresAt is in the future", () => {
    vi.setSystemTime(1_000_000);
    expect(isSessionExpired(1_000_000 + 1)).toBe(false);
  });

  it("returns true when expiresAt equals now", () => {
    vi.setSystemTime(1_000_000);
    expect(isSessionExpired(1_000_000)).toBe(true);
  });

  it("returns true when expiresAt is in the past", () => {
    vi.setSystemTime(2_000_000);
    expect(isSessionExpired(1_000_000)).toBe(true);
  });
});

describe("clearPersistedSession", () => {
  beforeEach(() => localStorage.clear());

  it("removes all auth keys from localStorage", () => {
    populateStorage();
    clearPersistedSession();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.EXPIRES_AT)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.USER)).toBeNull();
  });

  it("is safe to call when storage is empty", () => {
    expect(() => clearPersistedSession()).not.toThrow();
  });
});

describe("readPersistedSession", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => vi.useRealTimers());

  it("returns null when localStorage is empty", () => {
    expect(readPersistedSession()).toBeNull();
  });

  it("returns null when any field is missing", () => {
    populateStorage({ token: null });
    expect(readPersistedSession()).toBeNull();

    localStorage.clear();
    populateStorage({ refreshToken: null });
    expect(readPersistedSession()).toBeNull();

    localStorage.clear();
    populateStorage({ expiresAt: null });
    expect(readPersistedSession()).toBeNull();

    localStorage.clear();
    populateStorage({ user: null });
    expect(readPersistedSession()).toBeNull();
  });

  it("returns null and clears storage when session is expired", () => {
    populateStorage({ expiresAt: -1 });
    expect(readPersistedSession()).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN)).toBeNull();
  });

  it("returns the session when valid and not expired", () => {
    const expiresAt = 900_000;
    populateStorage({ expiresAt });

    const session = readPersistedSession();
    expect(session).not.toBeNull();
    expect(session?.token).toBe("access-token");
    expect(session?.refreshToken).toBe("refresh-token");
    expect(session?.expiresAt).toBe(expiresAt);
    expect(session?.user).toEqual(mockUser);
  });

  it("returns null and clears storage when expiresAt is not a number", () => {
    populateStorage();
    localStorage.setItem(AUTH_STORAGE_KEYS.EXPIRES_AT, '"not-a-number"');
    expect(readPersistedSession()).toBeNull();
  });

  it("returns null when localStorage contains malformed JSON", () => {
    localStorage.setItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN, "token");
    localStorage.setItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN, "refresh");
    localStorage.setItem(AUTH_STORAGE_KEYS.EXPIRES_AT, "{{bad");
    localStorage.setItem(AUTH_STORAGE_KEYS.USER, JSON.stringify(mockUser));
    expect(readPersistedSession()).toBeNull();
  });
});
