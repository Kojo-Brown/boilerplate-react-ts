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

function loadInitialState(): AuthState {
  try {
    const token = localStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN);
    const refreshToken = localStorage.getItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN);
    const expiresAtRaw = localStorage.getItem(AUTH_STORAGE_KEYS.EXPIRES_AT);
    const userRaw = localStorage.getItem(AUTH_STORAGE_KEYS.USER);

    if (!token || !refreshToken || !expiresAtRaw || !userRaw) {
      return { token: null, refreshToken: null, expiresAt: null, user: null };
    }

    const expiresAt = JSON.parse(expiresAtRaw) as unknown;
    if (typeof expiresAt !== "number" || Date.now() >= expiresAt) {
      (Object.values(AUTH_STORAGE_KEYS) as string[]).forEach((k) => {
        localStorage.removeItem(k);
      });
      return { token: null, refreshToken: null, expiresAt: null, user: null };
    }

    const user = JSON.parse(userRaw) as AuthUser;
    return { token, refreshToken, expiresAt, user };
  } catch {
    return { token: null, refreshToken: null, expiresAt: null, user: null };
  }
}

const initialState: AuthState = loadInitialState();

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
      (Object.values(AUTH_STORAGE_KEYS) as string[]).forEach((key) => {
        localStorage.removeItem(key);
      });
    },
  },
});

export const { setCredentials, refreshAccessToken, logout } = authSlice.actions;
