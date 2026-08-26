import { env } from "@/shared/config/env";
import { store } from "@/app/store";
import { logout, refreshAccessToken } from "@/entities/session/authSlice";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body?: unknown,
  ) {
    super(`Request failed: ${status} ${statusText}`);
    this.name = "ApiError";
  }
}

let isRefreshing = false;
const pendingQueue: Array<(token: string | null) => void> = [];

function drainQueue(token: string | null): void {
  pendingQueue.forEach((resolve) => {
    resolve(token);
  });
  pendingQueue.length = 0;
}

async function attemptTokenRefresh(): Promise<string | null> {
  const { refreshToken } = store.getState().auth;
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${env.VITE_API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { token: string; expiresIn: number };
    store.dispatch(refreshAccessToken({ token: data.token, expiresIn: data.expiresIn }));
    return data.token;
  } catch {
    return null;
  }
}

async function executeRequest<T>(
  url: string,
  init: RequestInit | undefined,
  token: string | null,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    // An error body is caller-defined JSON; `unknown` keeps it honest rather
    // than letting `any` leak into ApiError's payload.
    const body: unknown = await res.json().catch(() => undefined);
    throw new ApiError(res.status, res.statusText, body);
  }
  return res.json() as Promise<T>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${env.VITE_API_URL}${path}`;
  const currentToken = store.getState().auth.token;

  try {
    return await executeRequest<T>(url, init, currentToken);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err;
  }

  // Access token rejected — attempt a silent refresh
  if (isRefreshing) {
    return new Promise<T>((resolve, reject) => {
      pendingQueue.push((newToken) => {
        executeRequest<T>(url, init, newToken).then(resolve).catch(reject);
      });
    });
  }

  isRefreshing = true;
  let newToken: string | null = null;
  try {
    newToken = await attemptTokenRefresh();
  } finally {
    isRefreshing = false;
  }
  drainQueue(newToken);

  if (!newToken) {
    store.dispatch(logout());
    throw new ApiError(401, "Unauthorized");
  }

  return executeRequest<T>(url, init, newToken);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
