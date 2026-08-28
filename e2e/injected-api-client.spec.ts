/**
 * The injected API client, exercised in a real browser.
 *
 * jsdom answers `fetch` from whatever the test wired up, so a unit test proves
 * the *seam* but never the transport underneath it: `PostFeed.test.tsx` would
 * pass whether or not the real client ever issued a request. These two tests
 * are the other half — the live client making an actual `GET /posts` that
 * Playwright intercepts, and the stub subtree making none at all.
 *
 * MSW is disabled under Playwright (see `playwright.config.ts`), so
 * `page.route()` owns the network here.
 */

import { test, expect } from "@playwright/test";
import { API_BASE } from "./fixtures";

const LIVE_POSTS = [
  { id: 1, title: "Served over the wire", body: "Intercepted by page.route()", userId: 1 },
];

test.describe("injected API client", () => {
  test("the live client issues a real request the browser can see", async ({ page }) => {
    let requests = 0;
    await page.route(`${API_BASE}/posts`, async (route) => {
      requests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(LIVE_POSTS),
      });
    });

    await page.goto("/labs/dependency-inversion");

    await expect(page.getByText("Served over the wire")).toBeVisible();
    // At least one, not exactly one: the dev server runs under StrictMode, which
    // mounts twice, and the query the first mount started is aborted rather than
    // never sent — page.route() has already counted it by then. The claim worth
    // making here is that a request left the browser at all, which is the one
    // thing a jsdom test cannot establish.
    expect(requests).toBeGreaterThanOrEqual(1);
  });

  test("the stub subtree renders the same component with no network at all", async ({ page }) => {
    let requests = 0;
    await page.route(`${API_BASE}/posts`, async (route) => {
      requests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(LIVE_POSTS),
      });
    });

    await page.goto("/labs/dependency-inversion?client=stub");

    await expect(page.getByText("Injected by the stub client")).toBeVisible();
    await expect(page.getByTestId("stub-call-log")).toContainText("GET /posts");
    // The request the log records never left the page.
    expect(requests).toBe(0);
  });

  test("switching the client swaps the implementation under the same feed", async ({ page }) => {
    await page.route(`${API_BASE}/posts`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(LIVE_POSTS),
      }),
    );

    await page.goto("/labs/dependency-inversion");
    await expect(page.getByText("Served over the wire")).toBeVisible();

    await page.getByTestId("client-mode-stub").click();

    await expect(page.getByText("Injected by the stub client")).toBeVisible();
    await expect(page.getByText("Served over the wire")).toBeHidden();
  });
});
