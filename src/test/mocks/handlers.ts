import { http, HttpResponse } from "msw";

const API = "http://localhost:4000";

export const authHandlers = [
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
  http.post(`${API}/auth/google/callback`, () =>
    HttpResponse.json({
      token: "google-access-token",
      refreshToken: "google-refresh-token",
      expiresIn: 3600,
      user: { id: "2", email: "google@example.com", role: "user" },
    }),
  ),
];

export const postHandlers = [
  http.get(`${API}/posts`, () =>
    HttpResponse.json([
      { id: 1, title: "First Post", body: "Content one", userId: 1 },
      { id: 2, title: "Second Post", body: "Content two", userId: 1 },
    ]),
  ),
  http.get(`${API}/posts/:id`, ({ params }) => {
    // A path param is typed as string | readonly string[] because a pattern can
    // match repeated segments; this route only ever binds a single value.
    const id = Number(params["id"]);
    return HttpResponse.json({
      id,
      title: `Post ${id}`,
      body: "Post body content",
      userId: 1,
    });
  }),
  http.post(`${API}/posts`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ id: 100, ...body }, { status: 201 });
  }),
  http.put(`${API}/posts/:id`, async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ id: Number(params["id"]), ...body });
  }),
  http.delete(`${API}/posts/:id`, () => new HttpResponse(null, { status: 204 })),
];

export const handlers = [...authHandlers, ...postHandlers];
