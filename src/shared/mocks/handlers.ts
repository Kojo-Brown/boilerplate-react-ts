import { http, HttpResponse, delay } from "msw";
import {
  DEMO_IMAGE_DELAY_MS,
  DEMO_IMAGE_PNG_BASE64,
  DEMO_MEDIA_PREFIX,
} from "@/shared/lib/demoImages";
// Type-only, and so exempt from the import-boundary rule's layer order: it is
// erased before a module graph exists. The point of naming the real type here
// is that a change to `Post` fails the type check in the mock that claims to
// serve one, rather than leaving the mock quietly describing something else.
import type { Post } from "@/entities/post/postsApi";

const API = "http://localhost:4000";

/**
 * The refresh cookie's name, and the server's half of the token-storage
 * contract.
 *
 * `HttpOnly` is the attribute the whole item turns on: it is what makes the
 * refresh token unreadable from JavaScript, so an XSS payload that can read
 * every `localStorage` key on the origin still cannot exfiltrate the
 * long-lived credential. The rest earn their place too:
 *
 * - `Path=/auth` — the cookie is attached to `/auth/refresh` and `/auth/logout`
 *   and withheld from `/posts`, `/feed` and everything else. A credential that
 *   travels on requests that have no use for it is a credential with a larger
 *   blast radius than it needs.
 * - `SameSite=Strict` — a cross-site request cannot carry it, which is what
 *   closes the CSRF hole that a cookie-borne credential otherwise opens.
 *   `Strict` rather than `Lax` because nothing in this flow is a top-level
 *   navigation: the refresh is always an XHR made by our own origin.
 * - `Max-Age` — the refresh token outlives the access token by design, and
 *   bounding it means a stolen cookie is not valid forever.
 *
 * `Secure` is absent *only* because these mocks serve `http://localhost`, where
 * a `Secure` cookie is dropped by the browser. `docs/token-storage.md` carries
 * the production header, which has it; `cookieAttributes.test.ts` asserts the
 * shape so the omission cannot quietly spread to the attributes that are not
 * environment-dependent.
 */
export const REFRESH_COOKIE_NAME = "refresh_token";

const REFRESH_TOKEN_VALUE = "mock-refresh-token";
const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/** The `Set-Cookie` that issues the refresh cookie. */
export function issueRefreshCookie(value = REFRESH_TOKEN_VALUE): string {
  return [
    `${REFRESH_COOKIE_NAME}=${value}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/auth",
    `Max-Age=${REFRESH_MAX_AGE_SECONDS}`,
  ].join("; ");
}

/** The `Set-Cookie` that revokes it. `Max-Age=0` is the expiry browsers honour. */
export function clearRefreshCookie(): string {
  return [`${REFRESH_COOKIE_NAME}=`, "HttpOnly", "SameSite=Strict", "Path=/auth", "Max-Age=0"].join(
    "; ",
  );
}

const MOCK_USER = { id: "1", email: "test@example.com", role: "user" } as const;

export const authHandlers = [
  http.post(`${API}/auth/login`, () =>
    HttpResponse.json(
      {
        token: "mock-access-token",
        expiresIn: 900,
        user: MOCK_USER,
      },
      { headers: { "Set-Cookie": issueRefreshCookie() } },
    ),
  ),

  /*
    Answers from the cookie, and 401s without it.

    This is the half that makes the contract testable rather than assumed. A
    handler that returned a token unconditionally would pass every test in the
    suite while the client sent no cookie at all — which is precisely the
    regression `credentials: "include"` exists to prevent, and precisely the one
    an always-200 mock cannot see. `e2e/token-storage.spec.ts` checks the same
    contract against a real browser's cookie jar.
  */
  http.post(`${API}/auth/refresh`, ({ cookies }) => {
    if (cookies[REFRESH_COOKIE_NAME] === undefined) {
      return HttpResponse.json({ message: "No refresh cookie" }, { status: 401 });
    }
    return HttpResponse.json(
      { token: "mock-refreshed-token", expiresIn: 900, user: MOCK_USER },
      // Rotated on every use: a refresh token that is accepted twice is a
      // refresh token a thief can keep using alongside its owner.
      { headers: { "Set-Cookie": issueRefreshCookie("mock-rotated-refresh-token") } },
    );
  }),

  http.post(
    `${API}/auth/logout`,
    () => new HttpResponse(null, { status: 200, headers: { "Set-Cookie": clearRefreshCookie() } }),
  ),

  http.get(`${API}/auth/me`, () => HttpResponse.json(MOCK_USER)),

  http.post(`${API}/auth/google/callback`, () =>
    HttpResponse.json(
      {
        token: "google-access-token",
        expiresIn: 3600,
        user: { id: "2", email: "google@example.com", role: "user" },
      },
      { headers: { "Set-Cookie": issueRefreshCookie("google-refresh-token") } },
    ),
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

/** Rows the mock feed holds. Large enough that windowing is the only way. */
export const FEED_TOTAL = 5_000;

/** The mock feed's rows are a pure function of their index. */
function makeFeedItem(index: number): Post {
  return {
    id: index + 1,
    title: `Feed item ${index + 1}`,
    body: `Body for feed item ${index + 1}, generated by the mock server.`,
    userId: (index % 10) + 1,
  };
}

export const feedHandlers = [
  /**
   * Cursor-paginated feed backing `/labs/infinite-scroll`.
   *
   * The cursor is the index of the first row of the *next* page, as a string.
   * Opaque to the client by contract — `useInfiniteFeed` only ever echoes it
   * back — which is what lets it stay a number here and become a keyset
   * predicate against a real database without the client changing.
   */
  http.get(`${API}/feed`, ({ request }) => {
    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200)
      : 50;
    const requestedCursor = Number(url.searchParams.get("cursor") ?? 0);
    const start = Number.isFinite(requestedCursor)
      ? Math.min(Math.max(Math.trunc(requestedCursor), 0), FEED_TOTAL)
      : 0;

    const end = Math.min(start + limit, FEED_TOTAL);
    return HttpResponse.json({
      items: Array.from({ length: end - start }, (_, i) => makeFeedItem(start + i)),
      nextCursor: end < FEED_TOTAL ? String(end) : null,
      total: FEED_TOTAL,
    });
  }),
];

/**
 * Every candidate URL behind `/labs/images`, answered by one small PNG.
 *
 * Deliberately format-blind: the same bytes come back for `.avif`, `.webp` and
 * `.jpeg`. Selection is decided from the `<source type>` attribute before this
 * handler is reached, so serving one image exercises the real algorithm — see
 * the note in `demoImages.ts` about what that does and does not demonstrate.
 *
 * The `Content-Type` is `image/png` regardless of the extension asked for,
 * because a header claiming a format the bytes are not is a lie the browser
 * would be right to act on, and browsers sniff raster images anyway.
 */
export const mediaHandlers = [
  http.get(`${DEMO_MEDIA_PREFIX}/:file`, async () => {
    await delay(DEMO_IMAGE_DELAY_MS);
    const binary = atob(DEMO_IMAGE_PNG_BASE64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new HttpResponse(bytes, {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  }),
];

export const handlers = [...authHandlers, ...postHandlers, ...feedHandlers, ...mediaHandlers];
