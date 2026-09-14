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
  webServer: [
    {
      // MSW's service worker would intercept requests before page.route() —
      // disable it so each test fully controls the network.
      command: "pnpm dev",
      env: {
        VITE_DISABLE_MSW: "true",
        // Turns the vitals reporter on with a same-origin collector that
        // `web-vitals.spec.ts` intercepts. Without an endpoint the reporter
        // subscribes to nothing, so the beacon could never be observed.
        VITE_ANALYTICS_URL: "http://localhost:3000/__vitals",
        // Same arrangement for errors: with no endpoint the reporter uses the
        // console transport, and `route-error-boundary.spec.ts` would have no
        // request to intercept — so the one thing only a real browser can prove,
        // that an event leaves as a beacon, would go untested.
        VITE_ERROR_REPORT_URL: "http://localhost:3000/__errors",
        VITE_RELEASE: "e2e-test-build",
      },
      url: "http://localhost:3000",
      reuseExistingServer: !process.env["CI"],
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    },
    {
      /*
        A second server, for `offline.spec.ts` alone.

        The service worker is emitted by a second build (`vite.sw.config.ts`)
        and does not exist under `vite dev`, and `src/app/main.tsx` registers
        it only in a production build — where MSW's own worker, which would
        otherwise be fighting it for the same scope, is not started either. So
        the only place the worker can be exercised is a preview of a real
        build, and that is what this serves. It costs the E2E job one build;
        the alternative is shipping a service worker no test has ever run.
      */
      command: "pnpm build && pnpm preview --port 3100 --strictPort",
      url: "http://localhost:3100",
      reuseExistingServer: !process.env["CI"],
      stdout: "pipe",
      stderr: "pipe",
      timeout: 240_000,
    },
    {
      // Answers the writes the offline queue replays. A replayed write is
      // issued by the service worker rather than by the page, so `page.route`
      // never sees it and something real has to accept it — see
      // `e2e/offlineApiServer.ts`. The preview server proxies `/api` here.
      command: "node e2e/offlineApiServer.ts",
      url: "http://localhost:4000/health",
      reuseExistingServer: !process.env["CI"],
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
    },
  ],
});
