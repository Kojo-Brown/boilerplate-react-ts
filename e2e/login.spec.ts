import { test, expect } from "@playwright/test";
import { API_BASE, mockAuthResponse } from "./fixtures";

test.describe("Login flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("renders login form", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign in with Google/i })).toBeVisible();
  });

  test("shows client-side validation errors on empty submit", async ({ page }) => {
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Invalid email address")).toBeVisible();
    await expect(page.getByText("Password must be at least 8 characters")).toBeVisible();
  });

  test("shows validation error for malformed email", async ({ page }) => {
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Invalid email address")).toBeVisible();
  });

  test("successful login redirects to dashboard", async ({ page }) => {
    await page.route(`${API_BASE}/auth/login`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockAuthResponse),
      }),
    );

    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("redirects to original destination after login", async ({ page }) => {
    await page.route(`${API_BASE}/auth/login`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockAuthResponse),
      }),
    );

    // Navigate directly to a protected route — should be redirected to login
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);

    // Log in — should return to the originally requested page
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL("/dashboard");
  });

  test("shows invalid credentials error on 401", async ({ page }) => {
    await page.route(`${API_BASE}/auth/login`, (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({}) }),
    );

    await page.getByLabel("Email").fill("wrong@example.com");
    await page.getByLabel("Password").fill("wrongpassword");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page.getByRole("alert")).toContainText("Invalid email or password");
    await expect(page).toHaveURL("/login");
  });

  test("shows server error message on 500", async ({ page }) => {
    await page.route(`${API_BASE}/auth/login`, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({}) }),
    );

    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page.getByRole("alert")).toContainText("Server error");
    await expect(page).toHaveURL("/login");
  });
});
