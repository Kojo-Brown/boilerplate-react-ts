import { test as base, type Page, type Route, type BrowserContext } from "@playwright/test";

export const API_BASE = "http://localhost:4000";

/** The application's own origin, which the dev server in `playwright.config.ts` serves. */
export const APP_ORIGIN = "http://localhost:3000";

/** Must mirror `REFRESH_COOKIE_NAME` in src/shared/mocks/handlers.ts */
export const REFRESH_COOKIE_NAME = "refresh_token";

export const mockUser = {
  id: "1",
  email: "test@example.com",
  role: "user" as const,
};

/**
 * A successful login, as the server now answers it.
 *
 * No `refreshToken` field: the refresh token is a `Set-Cookie` header the
 * browser keeps and JavaScript cannot read. See `docs/token-storage.md`.
 */
export const mockAuthResponse = {
  token: "e2e-access-token",
  expiresIn: 900,
  user: mockUser,
};

/**
 * Fulfils `route` with a JSON body.
 *
 * No CORS headers, and no preflight branch, although the application and the
 * API are different origins here and the auth requests are now credentialed —
 * which in a browser talking to a real server would require both. A fulfilled
 * Playwright route is injected below the point where the browser applies CORS,
 * so neither is reached: verified by removing them and re-running this suite,
 * which stays green. Spelling them out anyway would be code with a confident
 * and false justification attached, which is worse than no code.
 *
 * The real headers are not untested, though — they are what
 * `shared/mocks/handlers.ts` and the production server send, and the `Set-Cookie`
 * one case here does depend on is passed through `headers`.
 */
export async function fulfillJson(
  route: Route,
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Promise<void> {
  await route.fulfill({
    status: init.status ?? 200,
    contentType: "application/json",
    headers: init.headers ?? {},
    body: JSON.stringify(body),
  });
}

/**
 * Puts an `HttpOnly` refresh cookie in the browser's own cookie jar.
 *
 * `addCookies` rather than a `Set-Cookie` from a login response, because the
 * fixture's job is to arrive already signed in and a real login is what
 * `login.spec.ts` is for. `httpOnly: true` is the attribute under test
 * elsewhere, and it is set here so the fixture's session is the same kind of
 * session the application actually issues — a fixture that seeded a readable
 * cookie would leave `token-storage.spec.ts` asserting against a session no
 * user ever has.
 *
 * `domain: "localhost"` with no port: cookies are not scoped by port, so one
 * entry covers the app on 3000 and the API on 4000. `path: "/auth"` mirrors the
 * server's own scoping, which is also what proves the cookie is *not* sent to
 * `/posts`.
 */
export async function seedRefreshCookie(
  context: BrowserContext,
  value = "e2e-refresh-token",
): Promise<void> {
  await context.addCookies([
    {
      name: REFRESH_COOKIE_NAME,
      value,
      domain: "localhost",
      path: "/auth",
      httpOnly: true,
      sameSite: "Strict",
      expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
    },
  ]);
}

/**
 * Answers `POST /auth/refresh` from the cookie, exactly as the server does.
 *
 * The conditional is the point. A handler that returned a token unconditionally
 * would make `authedPage` work whether or not the application sent the cookie,
 * so the one regression this item is most exposed to — somebody dropping
 * `credentials: "include"` — would leave every E2E spec green. Reading the
 * cookie off the request means the fixture can only succeed if the client asked
 * for it correctly.
 *
 * `allHeaders()` rather than `headers()`: the latter is served from the
 * browser's pre-flight view of the request and omits headers the network stack
 * adds, `Cookie` among them.
 */
export async function routeRefreshFromCookie(page: Page): Promise<void> {
  await page.route(`${API_BASE}/auth/refresh`, async (route) => {
    const headers = await route.request().allHeaders();
    const cookie = headers["cookie"] ?? "";

    if (!cookie.includes(`${REFRESH_COOKIE_NAME}=`)) {
      await fulfillJson(route, { message: "No refresh cookie" }, { status: 401 });
      return;
    }

    await fulfillJson(route, mockAuthResponse);
  });
}

type AppFixtures = {
  /**
   * A page that arrives signed in, the way a returning user does.
   *
   * Seeded as an `HttpOnly` cookie plus a live `/auth/refresh` route, not as
   * four `localStorage` keys. That difference is not cosmetic: the previous
   * fixture wrote the access token straight into the store's initial state, so
   * every spec using it exercised a code path the application no longer has.
   * This one makes the application do what it does in production — boot with an
   * empty store and restore from the cookie — so a spec that passes here is a
   * spec that passes for a real user.
   */
  authedPage: Page;
};

export const test = base.extend<AppFixtures>({
  async authedPage({ page, context }, use) {
    await seedRefreshCookie(context);
    await routeRefreshFromCookie(page);
    await page.goto("/");
    await use(page);
  },
});

export { expect } from "@playwright/test";
