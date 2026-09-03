/**
 * Route prefetching against a real browser and a real module graph.
 *
 * The unit suite drives the queue through a scheduler it flushes by hand and a
 * registry of loaders it settles by hand, which is the only way to assert on a
 * budget — jsdom has no `requestIdleCallback` and nothing that could decide
 * when the main thread is free. What it cannot show is the thing the feature
 * is for: that hovering a link puts that route's *module* on the wire, and that
 * nothing puts it there otherwise.
 *
 * Under `pnpm dev` Vite serves each module at its source path, so a route's
 * chunk arriving is literally a request for `…/HeadlessLabPage.tsx`. That is
 * what is watched here.
 *
 * **What is deliberately not asserted here: the hover dwell.** Whether a
 * pointer that passes straight over a link stays under ~65ms is a question
 * about how long a CDP round trip took, not about the code — the assertion
 * would pass or fail on runner load. `usePrefetchTriggers.test.tsx` pins it
 * exactly, with fake timers.
 */

import { test, expect, type Page } from "@playwright/test";

/** A hover link on the lab page, and the module it should warm. */
const HOVER_TARGET = { name: "Headless lab", module: "HeadlessLabPage" } as const;
/** The link below the fold, reached by scrolling rather than pointing. */
const VIEWPORT_TARGET = { testId: "viewport-link", module: "WorkerLabPage" } as const;

/** Room for an idle callback plus the dev server transforming the module. */
const PREFETCH_TIMEOUT_MS = 15_000;

function watchRequests(page: Page): { urls: readonly string[] } {
  const urls: string[] = [];
  page.on("request", (request) => {
    urls.push(request.url());
  });
  return { urls };
}

function requested(urls: readonly string[], module: string): boolean {
  return urls.some((url) => url.includes(module));
}

async function openLab(page: Page): Promise<{ urls: readonly string[] }> {
  const watcher = watchRequests(page);
  await page.goto("/labs/prefetch");
  await expect(page.getByRole("heading", { level: 1, name: "Route prefetch" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  return watcher;
}

test.describe("route prefetch", () => {
  test("loads no route module until something asks for one", async ({ page }) => {
    const { urls } = await openLab(page);

    // The baseline the rest of the file depends on. If arriving on this page
    // already pulled these in, every assertion below would pass vacuously.
    expect(requested(urls, HOVER_TARGET.module)).toBe(false);
    expect(requested(urls, VIEWPORT_TARGET.module)).toBe(false);
  });

  test("hovering a link puts its route module on the wire", async ({ page }) => {
    const { urls } = await openLab(page);

    await page.getByRole("link", { name: HOVER_TARGET.name }).hover();

    await expect
      .poll(() => requested(urls, HOVER_TARGET.module), { timeout: PREFETCH_TIMEOUT_MS })
      .toBe(true);

    // Only the route that was hovered: a hover is not a reason to warm the
    // page's other links.
    expect(requested(urls, VIEWPORT_TARGET.module)).toBe(false);
  });

  test("the queue reports the hovered route as loaded", async ({ page }) => {
    // The network request says the bytes were asked for. This says the queue
    // saw them arrive — the two are different, and a promise that never
    // settles would show as a request and a permanent "Loading".
    await openLab(page);

    await page.getByRole("link", { name: HOVER_TARGET.name }).hover();

    await expect(page.getByTestId("queue-loaded")).toContainText("/labs/headless", {
      timeout: PREFETCH_TIMEOUT_MS,
    });
    await expect(page.getByTestId("queue-queued")).toHaveAttribute("data-count", "0");
  });

  test("scrolling a link into view fetches it without it being touched", async ({ page }) => {
    const { urls } = await openLab(page);

    // 150vh of deliberate gap sits above it, so this is a real geometric
    // question rather than one a shorter page could fake.
    expect(requested(urls, VIEWPORT_TARGET.module)).toBe(false);

    await page.getByTestId(VIEWPORT_TARGET.testId).scrollIntoViewIfNeeded();

    await expect
      .poll(() => requested(urls, VIEWPORT_TARGET.module), { timeout: PREFETCH_TIMEOUT_MS })
      .toBe(true);
  });

  test("a route already warmed is not fetched again", async ({ page }) => {
    const { urls } = await openLab(page);
    const link = page.getByRole("link", { name: HOVER_TARGET.name });

    await link.hover();
    await expect
      .poll(() => requested(urls, HOVER_TARGET.module), { timeout: PREFETCH_TIMEOUT_MS })
      .toBe(true);

    const afterFirst = urls.filter((url) => url.includes(HOVER_TARGET.module)).length;

    // Away and back: a second dwell on a route the queue has already loaded.
    await page.getByRole("heading", { level: 1, name: "Route prefetch" }).hover();
    await link.hover();
    await page.waitForLoadState("networkidle");

    expect(urls.filter((url) => url.includes(HOVER_TARGET.module)).length).toBe(afterFirst);
  });
});
