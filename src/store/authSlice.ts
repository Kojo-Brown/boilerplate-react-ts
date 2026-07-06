import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type UserRole = "admin" | "editor" | "user";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface AuthState {
  token: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  user: AuthUser | null;
}

export const AUTH_STORAGE_KEYS = {
  ACCESS_TOKEN: "auth.accessToken",
  REFRESH_TOKEN: "auth.refreshToken",
  EXPIRES_AT: "auth.expiresAt",
  USER: "auth.user",
} as const;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

const initialState: AuthState = {
  token: localStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN),
  refreshToken: localStorage.getItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN),
  expiresAt: readJson<number>(AUTH_STORAGE_KEYS.EXPIRES_AT),
  user: readJson<AuthUser>(AUTH_STORAGE_KEYS.USER),
};

export interface SetCredentialsPayload {
  token: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

export interface RefreshAccessTokenPayload {
  token: string;
  expiresIn: number;
}

export const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setCredentials(state, action: PayloadAction<SetCredentialsPayload>) {
      const { token, refreshToken, expiresIn, user } = action.payload;
      const expiresAt = Date.now() + expiresIn * 1000;
      state.token = token;
      state.refreshToken = refreshToken;
      state.expiresAt = expiresAt;
      state.user = user;
      localStorage.setItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN, token);
      localStorage.setItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
      localStorage.setItem(AUTH_STORAGE_KEYS.EXPIRES_AT, JSON.stringify(expiresAt));
      localStorage.setItem(AUTH_STORAGE_KEYS.USER, JSON.stringify(user));
    },
    refreshAccessToken(state, action: PayloadAction<RefreshAccessTokenPayload>) {
      const { token, expiresIn } = action.payload;
      const expiresAt = Date.now() + expiresIn * 1000;
      state.token = token;
      state.expiresAt = expiresAt;
      localStorage.setItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN, token);
      localStorage.setItem(AUTH_STORAGE_KEYS.EXPIRES_AT, JSON.stringify(expiresAt));
    },
    logout(state) {
      state.token = null;
      state.refreshToken = null;
      state.expiresAt = null;
      state.user = null;
      (Object.values(AUTH_STORAGE_KEYS) as string[]).forEach((key) =>
        localStorage.removeItem(key),
      );
    },
  },
});

export const { setCredentials, refreshAccessToken, logout } = authSlice.actions;
