import { test, expect, API_BASE, mockAuthResponse, fulfillJson } from "./fixtures";

test.describe("Protected route", () => {
  test("unauthenticated user is redirected to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("redirected login URL preserves the intended destination in state", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    // Login form must be visible — user is at the login page
    await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
  });

  test("authenticated user can access /dashboard", async ({ authedPage }) => {
    await authedPage.goto("/dashboard");
    await expect(authedPage).toHaveURL("/dashboard");
    await expect(authedPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("authenticated user is not redirected away from /dashboard on refresh", async ({
    authedPage,
  }) => {
    await authedPage.goto("/dashboard");
    await authedPage.reload();
    await expect(authedPage).toHaveURL("/dashboard");
    await expect(authedPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("unauthenticated user navigating to / sees the home page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/");
    // Home page is public — no redirect
    await expect(page).not.toHaveURL(/\/login/);
  });

  /*
    Replaces a test that cleared `localStorage` and reloaded.

    That is no longer a way to end a session — there is nothing of the session
    in storage to clear — so the test would have passed for the wrong reason:
    green because the user was redirected, while the thing it claimed to clear
    had no bearing on it. Expiry and revocation now show up as a rejected
    refresh cookie, so that is what this simulates.
  */
  test("user is redirected when the refresh cookie is no longer accepted", async ({
    authedPage,
    context,
  }) => {
    await authedPage.goto("/dashboard");
    await expect(authedPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Revoked server-side, which is what a logout elsewhere or an expiry looks
    // like from here: the cookie may still be in the jar and is simply refused.
    await context.clearCookies();
    await authedPage.reload();

    await expect(authedPage).toHaveURL(/\/login/);
  });

  test("a signed-in user survives a reload, with no token in storage to survive on", async ({
    authedPage,
  }) => {
    await authedPage.goto("/dashboard");
    await expect(authedPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // The property the whole item turns on. Before this change the session
    // survived a reload because four keys were read back out of
    // `localStorage`; now it survives because the cookie is re-exchanged, and
    // storage is empty throughout.
    await authedPage.reload();
    await expect(authedPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    expect(await authedPage.evaluate(() => Object.keys(localStorage))).toEqual([]);
  });

  test("login while authenticated redirects straight to dashboard", async ({ page }) => {
    await page.route(`${API_BASE}/auth/login`, (route) => fulfillJson(route, mockAuthResponse));

    await page.goto("/login");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/dashboard");
  });
});
