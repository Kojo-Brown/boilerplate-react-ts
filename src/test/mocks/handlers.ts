import { http, HttpResponse } from "msw";

export const handlers = [
  http.post("/api/auth/login", () =>
    HttpResponse.json({ token: "mock-jwt-token", user: { id: "1", email: "test@example.com", role: "user" } }),
  ),
  http.get("/api/auth/me", () =>
    HttpResponse.json({ id: "1", email: "test@example.com", role: "user" }),
  ),
];
