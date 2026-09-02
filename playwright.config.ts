import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: process.env["CI"] ? 1 : undefined,
  reporter: [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    // MSW's service worker would intercept requests before page.route() —
    // disable it so each test fully controls the network.
    command: "pnpm dev",
    env: {
      VITE_DISABLE_MSW: "true",
      // Turns the vitals reporter on with a same-origin collector that
      // `web-vitals.spec.ts` intercepts. Without an endpoint the reporter
      // subscribes to nothing, so the beacon could never be observed.
      VITE_ANALYTICS_URL: "http://localhost:3000/__vitals",
    },
    url: "http://localhost:3000",
    reuseExistingServer: !process.env["CI"],
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  },
});
