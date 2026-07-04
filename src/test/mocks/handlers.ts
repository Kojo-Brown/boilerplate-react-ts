import { http, HttpResponse } from "msw";

const API = "http://localhost:4000";

export const handlers = [
  http.post(`${API}/auth/login`, () =>
    HttpResponse.json({
      token: "mock-access-token",
      refreshToken: "mock-refresh-token",
      expiresIn: 900,
      user: { id: "1", email: "test@example.com", role: "user" },
    }),
  ),
  http.post(`${API}/auth/refresh`, () =>
    HttpResponse.json({ token: "mock-refreshed-token", expiresIn: 900 }),
  ),
  http.post(`${API}/auth/logout`, () => new HttpResponse(null, { status: 200 })),
  http.get(`${API}/auth/me`, () =>
    HttpResponse.json({ id: "1", email: "test@example.com", role: "user" }),
  ),
];
