import { defineConfig, devices } from "@playwright/test";

/**
 * The accessibility gate's own Playwright configuration.
 *
 * A second config rather than a project inside `playwright.config.ts`, and the
 * reason is the server rather than tidiness. The main E2E config starts three
 * of them — a dev server with MSW *disabled* so `page.route()` owns the
 * network, a production preview for the service worker, and an HTTP server for
 * replayed writes — and Playwright starts every `webServer` a config declares
 * regardless of which project is selected. The audit needs exactly one server
 * and needs it configured the opposite way, with MSW answering so pages render
 * their real content rather than an empty state. Folding it in would make the
 * a11y job pay for a production build it never loads, and make every other
 * spec pay for a fourth server.
 *
 * The split also buys the thing a gate most needs: its own check in the pull
 * request, red on its own terms, named for what it measures.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /a11y\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  /*
   * No retries, unlike the E2E config's two.
   *
   * A retry is for a flaky *interaction* — a race, a network hiccup. An axe
   * result is a pure function of the rendered DOM: a violation that appears
   * once appears every time, and a retry can only turn a real failure into a
   * slower real failure. Keeping it at zero also means a genuinely flaky audit
   * step is visible as flake rather than hidden by a green second attempt.
   */
  retries: 0,
  workers: process.env["CI"] ? 1 : undefined,
  reporter: [["html", { outputFolder: "playwright-report-a11y", open: "never" }], ["list"]],
  use: {
    baseURL: "http://localhost:3200",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "a11y",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    /*
     * MSW left on, which is the whole point of not sharing the E2E server.
     * Most of these routes fetch something; without the mocks axe would audit
     * a skeleton and report zero violations for a page that has no content in
     * it yet.
     *
     * Port 3200 rather than 3000 so the two suites can run at the same time
     * locally without fighting over a port.
     */
    command: "pnpm dev --port 3200 --strictPort",
    env: {
      // The vitals and error reporters beacon to a collector that does not
      // exist here, and a failed beacon is a console error in every audited
      // page. Leaving both unset keeps them on their no-op transports.
      VITE_RELEASE: "a11y-audit",
    },
    url: "http://localhost:3200",
    reuseExistingServer: !process.env["CI"],
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  },
});
