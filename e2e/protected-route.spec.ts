import { test, expect, API_BASE, mockAuthResponse } from "./fixtures";

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

  test("user is logged out and redirected when token is cleared from storage", async ({
    authedPage,
  }) => {
    await authedPage.goto("/dashboard");
    await expect(authedPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Clear auth from storage — simulates expiry or manual logout
    await authedPage.evaluate(() => localStorage.clear());
    await authedPage.reload();

    await expect(authedPage).toHaveURL(/\/login/);
  });

  test("login while authenticated redirects straight to dashboard", async ({ page }) => {
    await page.route(`${API_BASE}/auth/login`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockAuthResponse),
      }),
    );

    await page.goto("/login");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/dashboard");
  });
});
