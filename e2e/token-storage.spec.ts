import {
  test,
  expect,
  API_BASE,
  APP_ORIGIN,
  REFRESH_COOKIE_NAME,
  mockAuthResponse,
  fulfillJson,
  routeRefreshFromCookie,
} from "./fixtures";

/**
 * The gate for the token-storage item, and the half that only a browser can
 * run.
 *
 * Everything else about this change is checked in jsdom: the slice writes
 * nothing to storage, the endpoints send `credentials: "include"`, the restore
 * dispatches synchronously. None of that can establish the property the item
 * actually buys, which is that an attacker who runs JavaScript on this origin
 * cannot read the long-lived credential. `HttpOnly` is enforced by the browser
 * and by nothing else — jsdom has no cookie jar of its own here, and MSW's
 * stand-in keeps its cookies in `localStorage`, where they are trivially
 * readable. A unit test asserting "the refresh token is not reachable" would
 * therefore be asserting a fact about the mock.
 *
 * So these cases run `document.cookie` and `localStorage` in a real Chromium
 * against a real `Set-Cookie`, which is the only place the answer means
 * anything.
 */
test.describe("Token storage", () => {
  test("a login puts no part of the session in localStorage or sessionStorage", async ({
    page,
  }) => {
    await page.route(`${API_BASE}/auth/login`, (route) =>
      fulfillJson(route, mockAuthResponse, {
        headers: {
          "Set-Cookie": `${REFRESH_COOKIE_NAME}=e2e-refresh-token; HttpOnly; SameSite=Strict; Path=/auth; Max-Age=604800`,
        },
      }),
    );

    await page.goto("/login");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/dashboard");

    const stored = await page.evaluate(() => {
      // Enumerated through `key()`/`length` rather than by spreading the
      // `Storage` instance: it is a class, and spreading one drops its
      // prototype (`@typescript-eslint/no-misused-spread`).
      const read = (storage: Storage): string[] => {
        const keys: string[] = [];
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key !== null) keys.push(key);
        }
        return keys.sort();
      };
      return { local: read(localStorage), session: read(sessionStorage) };
    });

    expect(stored.local).toEqual([]);
    expect(stored.session).toEqual([]);
  });

  test("the access token is never written to storage under any key", async ({ page }) => {
    await page.route(`${API_BASE}/auth/login`, (route) => fulfillJson(route, mockAuthResponse));

    await page.goto("/login");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/dashboard");

    /*
      Searched by *value* rather than by key name, because the regression does
      not have to reuse the old keys. `auth.accessToken` is gone, but
      `session`, `user`, or a persisted Redux store under `persist:root` would
      all leak the same token, and a check against four names would miss every
      one of them.
    */
    const leaked = await page.evaluate((token) => {
      const hits: string[] = [];
      for (const storage of [localStorage, sessionStorage]) {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key === null) continue;
          if ((storage.getItem(key) ?? "").includes(token)) hits.push(key);
        }
      }
      return hits;
    }, mockAuthResponse.token);

    expect(leaked).toEqual([]);
  });

  /**
   * The assertion the whole item is for.
   *
   * `document.cookie` is what an XSS payload has. The refresh cookie must be
   * absent from it while being present in the browser's jar and attached to the
   * refresh request — three facts that only hold together if `HttpOnly` is
   * doing its job.
   */
  test("the refresh cookie exists, is sent, and is unreadable from JavaScript", async ({
    authedPage,
    context,
  }) => {
    await authedPage.goto("/dashboard");
    await expect(authedPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Present in the jar, and flagged.
    const cookies = await context.cookies();
    const refresh = cookies.find((cookie) => cookie.name === REFRESH_COOKIE_NAME);
    expect(refresh).toBeDefined();
    expect(refresh?.httpOnly).toBe(true);
    expect(refresh?.sameSite).toBe("Strict");

    // And invisible to script running on the page.
    const visibleToScript = await authedPage.evaluate(() => document.cookie);
    expect(visibleToScript).not.toContain(REFRESH_COOKIE_NAME);
    expect(visibleToScript).not.toContain("e2e-refresh-token");
  });

  test("the session does not survive without the cookie", async ({ page, context }) => {
    // The negative control for the fixture. `authedPage` works because the
    // cookie is there; with no cookie the same routes must leave the user out.
    // Without this, a fixture that accidentally authenticated some other way
    // would make every positive case above meaningless.
    await routeRefreshFromCookie(page);
    await context.clearCookies();

    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/login/);
  });

  /**
   * `Path=/auth` is scoping, not decoration.
   *
   * A refresh token attached to every API call is a credential with a far
   * larger blast radius than it needs — any logging proxy, any mis-scoped
   * handler, any third-party sidecar on the API origin sees it. This checks the
   * browser actually withholds it from a data route, which is the behaviour the
   * `Path` attribute buys and the reason `credentials: "include"` was put on
   * the auth endpoints individually rather than on the shared base query.
   */
  test("the refresh cookie is not attached to data requests", async ({ authedPage }) => {
    // `/labs/dependency-inversion` renders `<PostFeed>`, which is the one
    // public route in the application that issues a `GET /posts`.
    const cookieHeaders: string[] = [];

    await authedPage.route(`${API_BASE}/posts`, async (route) => {
      const headers = await route.request().allHeaders();
      cookieHeaders.push(headers["cookie"] ?? "");
      await fulfillJson(route, []);
    });

    await authedPage.goto("/labs/dependency-inversion");
    await expect.poll(() => cookieHeaders.length).toBeGreaterThan(0);

    for (const header of cookieHeaders) {
      expect(header).not.toContain(REFRESH_COOKIE_NAME);
    }
  });

  test("a protected route waits for the restore rather than bouncing to /login", async ({
    context,
  }) => {
    /*
      The regression that would make this change worse than what it replaced.

      The access token is not persisted, so for one round trip after every
      reload a signed-in user is indistinguishable from a signed-out one. If
      `ProtectedRoute` redirected on that, every returning user would be thrown
      out of the application on refresh — and would stay out, because the
      restore completing does not un-navigate them.

      Held open deliberately: the refresh never resolves, so the page is pinned
      in the state that lasts milliseconds in production and the assertion is
      about the state rather than about winning a race.
    */
    const page = await context.newPage();
    await context.addCookies([
      {
        name: REFRESH_COOKIE_NAME,
        value: "e2e-refresh-token",
        domain: "localhost",
        path: "/auth",
        httpOnly: true,
        sameSite: "Strict",
        expires: Math.floor(Date.now() / 1000) + 3600,
      },
    ]);

    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    await page.route(`${API_BASE}/auth/refresh`, async (route) => {
      await held;
      await fulfillJson(route, mockAuthResponse);
    });

    await page.goto("/dashboard");

    // Still on /dashboard, showing the restore's loading state, not redirected.
    await expect(page.getByRole("status", { name: "Loading page" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/dashboard");

    // And it lands on the dashboard once the restore completes.
    release?.();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page).toHaveURL(`${APP_ORIGIN}/dashboard`);

    await page.close();
  });
});
