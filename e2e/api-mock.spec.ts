/**
 * API mock patterns for Playwright E2E tests.
 *
 * Demonstrates page.route() interception as the E2E counterpart to MSW handlers
 * used in unit/integration tests. Each test controls exactly what the API returns
 * so tests remain deterministic without a real backend.
 */

import { test, expect } from "@playwright/test";
import { API_BASE, mockAuthResponse, mockUser } from "./fixtures";

test.describe("API mock patterns", () => {
  test("intercepts login and returns mocked credentials", async ({ page }) => {
    let capturedBody: unknown;

    await page.route(`${API_BASE}/auth/login`, async (route) => {
      capturedBody = await route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockAuthResponse),
      });
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill(mockUser.email);
    await page.getByLabel("Password").fill("secret123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL("/dashboard");

    // Verify the request payload the app sent
    expect(capturedBody).toMatchObject({ email: mockUser.email, password: "secret123" });
  });

  test("simulates network failure and surfaces connection error", async ({ page }) => {
    await page.route(`${API_BASE}/auth/login`, (route) => route.abort("failed"));

    await page.goto("/login");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toContainText("Login failed");
  });

  test("mocks a 422 validation error response", async ({ page }) => {
    await page.route(`${API_BASE}/auth/login`, (route) =>
      route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ message: "Validation failed", errors: { email: "Already taken" } }),
      }),
    );

    await page.goto("/login");
    await page.getByLabel("Email").fill("taken@example.com");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toContainText("Please check your input");
  });

  test("intercepts multiple endpoints in a single test", async ({ page }) => {
    await page.route(`${API_BASE}/auth/login`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockAuthResponse),
      }),
    );

    // Mock a downstream data endpoint hit after login
    await page.route(`${API_BASE}/auth/me`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockUser),
      }),
    );

    await page.goto("/login");
    await page.getByLabel("Email").fill(mockUser.email);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL("/dashboard");
  });

  test("overrides a mock mid-test to simulate token expiry", async ({ page }) => {
    // First call succeeds
    await page.route(`${API_BASE}/auth/login`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockAuthResponse),
      }),
    );

    await page.goto("/login");
    await page.getByLabel("Email").fill(mockUser.email);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/dashboard");

    // Now simulate expiry: clear auth and assert the route guard fires on reload
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page).toHaveURL(/\/login/);
  });
});
