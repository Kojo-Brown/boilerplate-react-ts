import { test as base, type Page } from "@playwright/test";

/** Must mirror AUTH_STORAGE_KEYS in src/entities/session/authSlice.ts */
const AUTH_STORAGE_KEYS = {
  ACCESS_TOKEN: "auth.accessToken",
  REFRESH_TOKEN: "auth.refreshToken",
  EXPIRES_AT: "auth.expiresAt",
  USER: "auth.user",
} as const;

export const API_BASE = "http://localhost:4000";

export const mockUser = {
  id: "1",
  email: "test@example.com",
  role: "user" as const,
};

export const mockAuthResponse = {
  token: "e2e-access-token",
  refreshToken: "e2e-refresh-token",
  expiresIn: 900,
  user: mockUser,
};

async function seedAuthSession(page: Page): Promise<void> {
  await page.goto("/");
  const expiresAt = Date.now() + 15 * 60 * 1000;

  await page.evaluate(
    ({ keys, token, refreshToken, user, exp }) => {
      localStorage.setItem(keys.ACCESS_TOKEN, token);
      localStorage.setItem(keys.REFRESH_TOKEN, refreshToken);
      localStorage.setItem(keys.EXPIRES_AT, JSON.stringify(exp));
      localStorage.setItem(keys.USER, JSON.stringify(user));
    },
    {
      keys: AUTH_STORAGE_KEYS,
      token: mockAuthResponse.token,
      refreshToken: mockAuthResponse.refreshToken,
      user: mockAuthResponse.user,
      exp: expiresAt,
    },
  );
}

type AppFixtures = {
  /** Page with a valid auth session pre-seeded into localStorage. */
  authedPage: Page;
};

export const test = base.extend<AppFixtures>({
  async authedPage({ page }, use) {
    await seedAuthSession(page);
    await use(page);
  },
});

export { expect } from "@playwright/test";
