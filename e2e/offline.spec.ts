/**
 * The half of offline support that only a real browser has.
 *
 * `src/shared/offline/*` covers every strategy, the routing table and the
 * replay policy against fakes — a `Map`-backed cache, an in-memory queue, a
 * `fetch` that rejects on demand. What none of that can prove is the part that
 * is not this code: that a `ServiceWorkerGlobalScope` exists, that the wiring
 * in `src/app/sw/sw.ts` attaches to it, that the precache survives a reload,
 * and that a page with its network cut still opens. jsdom has no service
 * worker, no Cache API and no `FetchEvent`, so every one of those is untested
 * until here.
 *
 * Runs against the preview server on :3100 — a real production build, because
 * `/sw.js` is emitted by the second build and registered only when
 * `import.meta.env.PROD`. See `playwright.config.ts`.
 *
 * Nothing here depends on Background Sync. It is Chromium-only, and the path
 * that matters for every other engine is the one this drives: the page sees
 * the network return and asks the worker to replay.
 */

import { test, expect, type Page } from "@playwright/test";

test.use({ baseURL: "http://localhost:3100" });

/** The API path the worker queues writes to. Nothing serves it — see `queues a write`. */
const WRITE_URL = "/api/e2e-offline-write";

/** Resolves once a worker is controlling the page. */
async function waitForController(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 30_000,
  });
}

/**
 * Loads the application and waits until its worker is in charge.
 *
 * The first visit installs the worker and `clients.claim()` takes control of
 * the page that caused it, so one load is enough — but the precache is filled
 * during `install`, which is why every test that goes offline reloads first.
 */
async function installWorker(page: Page): Promise<void> {
  await page.goto("/");
  await waitForController(page);
}

test.describe("offline support", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Driven in Chromium only: the CI job runs that project, and the behaviour under test is the worker's rather than the engine's.",
  );

  test("registers a worker that takes control of the page", async ({ page }) => {
    await installWorker(page);

    const scope = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return registration.scope;
    });
    // Root scope, or the worker could not answer a navigation to any route.
    expect(scope).toBe("http://localhost:3100/");
  });

  test("opens the application with the network cut", async ({ page, context }) => {
    await installWorker(page);
    // The reload is what proves the *precache* is serving: the first load came
    // from the network, and the worker that installed during it had not filled
    // a cache when those requests were made.
    await page.reload();
    await waitForController(page);

    await context.setOffline(true);
    await page.reload();

    // The shell rendered with no network at all — script, stylesheet and HTML
    // all out of the precache.
    await expect(page.locator("#root")).not.toBeEmpty();
    await expect(page.getByText("Offline — showing saved data")).toBeVisible();
  });

  test("answers a navigation to a route that has no file behind it", async ({ page, context }) => {
    await installWorker(page);
    await page.reload();
    await waitForController(page);

    await context.setOffline(true);
    // Nothing is cached under this path and nothing ever could be: a
    // single-page application has no `/about/index.html`. The worker answers
    // with the shell and the router reads the URL.
    await page.goto("/about");

    await expect(page.locator("#root")).not.toBeEmpty();
    expect(page.url()).toContain("/about");
  });

  test("queues a write made offline instead of failing it", async ({ page, context }) => {
    await installWorker(page);
    await page.reload();
    await waitForController(page);
    await context.setOffline(true);

    const result = await page.evaluate(async (url) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "written while offline" }),
      });
      return { status: response.status, queued: response.headers.get("x-offline-queued") };
    }, WRITE_URL);

    // 202, not 200: accepted for processing, and the processing has not
    // happened. The banner says so rather than letting the interface imply the
    // write is saved.
    expect(result).toEqual({ status: 202, queued: "1" });
    await expect(page.getByTestId("offline-pending")).toHaveText("1 change waiting to sync");
  });

  test("keeps the queue across a reload, then drains it when the network returns", async ({
    page,
    context,
  }) => {
    await installWorker(page);
    await page.reload();
    await waitForController(page);
    await context.setOffline(true);

    await page.evaluate(async (url) => {
      await fetch(url, { method: "POST", body: "{}" });
    }, WRITE_URL);
    await expect(page.getByTestId("offline-pending")).toBeVisible();

    // The queue is in IndexedDB precisely so it survives this: the worker is
    // terminated whenever the browser judges it idle, and the page that made
    // the write is gone.
    await page.reload();
    await waitForController(page);
    await expect(page.getByTestId("offline-pending")).toHaveText("1 change waiting to sync");

    await context.setOffline(false);
    // The page asks the worker to replay the moment it sees the network back,
    // rather than waiting for a Background Sync event that Safari and Firefox
    // will never fire.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
    });

    // `e2e/offlineApiServer.ts` answers the replayed write with a 204, so the
    // entry leaves the queue for the reason it should: it was delivered.
    // Nothing the page can do would prove that — the request is the worker's,
    // and `page.route` does not see it — which is why that server exists.
    await expect(page.getByTestId("offline-pending")).toHaveCount(0);
  });
});
