/**
 * Windowed infinite scroll, in a browser that has a layout.
 *
 * Every claim this file makes is one jsdom cannot even be asked. The real
 * virtualizer needs a `ResizeObserver` and measurable elements and jsdom has
 * neither, so `VirtualInfiniteList.test.tsx` runs against a fake virtualizer
 * and can only assert what the component *does with* a window it was handed.
 * `IntersectionObserver` is the same story one layer down: a unit test can
 * check that the observer was constructed with the scroll container as its
 * root and a bottom `rootMargin`, but nothing in jsdom can decide whether that
 * margin is ever crossed.
 *
 * So the claims below are made here and nowhere else: that the DOM row count
 * stays flat while thousands of rows load, that the eager arm fetches ahead of
 * the scroll, that the zero-margin arm at the same scroll position does not,
 * and that a page landing without moving the sentinel does not stall the chain.
 *
 * Requests are counted by *distinct cursor*, never by hits. The dev server
 * runs under `<StrictMode>`, which mounts twice, so the first page can leave
 * two records for one logical request — see `injected-api-client.spec.ts`,
 * which hit the same thing. What matters here is which pages were asked for.
 *
 * MSW is disabled under Playwright (see `playwright.config.ts`), so
 * `page.route()` owns the network.
 */

import { test, expect, type Page, type Route } from "@playwright/test";

const TOTAL = 5_000;
const PAGE_SIZE = 50;

/** Matches the feed regardless of query string, without glob guesswork. */
const isFeedRequest = (url: URL): boolean =>
  url.host === "localhost:4000" && url.pathname === "/feed";

function feedItem(index: number) {
  return {
    id: index + 1,
    title: `Feed item ${index + 1}`,
    body: `Body for feed item ${index + 1}`,
    userId: 1,
  };
}

/**
 * Serve the feed from `page.route()`, recording the cursor of every request.
 *
 * The delay is load-bearing for the `end` arm: with an instant response the
 * spinner exists for less than a frame and the two arms become
 * indistinguishable. It is zero where a test is about counting instead.
 */
async function serveFeed(page: Page, cursors: number[], delayMs = 150, total = TOTAL) {
  await page.route(isFeedRequest, async (route: Route) => {
    const url = new URL(route.request().url());
    const cursor = Number(url.searchParams.get("cursor") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? PAGE_SIZE);
    cursors.push(cursor);

    const end = Math.min(cursor + limit, total);
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: Array.from({ length: end - cursor }, (_, i) => feedItem(cursor + i)),
        nextCursor: end < total ? String(end) : null,
        total,
      }),
    });
  });
}

/** Which pages were asked for, in ascending order and without repeats. */
const pagesAsked = (cursors: readonly number[]): number[] =>
  [...new Set(cursors)].sort((a, b) => a - b);

const container = (page: Page) => page.getByTestId("virtual-scroll-container");
const renderedRows = (page: Page) => page.getByRole("listitem");
const status = (page: Page) => page.getByTestId("load-more-status");

async function scrollBy(page: Page, delta: number): Promise<void> {
  await container(page).evaluate((el, by) => {
    el.scrollTop += by;
  }, delta);
  await page.waitForTimeout(150);
}

/** How far the container can still be scrolled. */
const remainingScroll = (page: Page) =>
  container(page).evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);

test.describe("windowed infinite scroll", () => {
  test("keeps the DOM row count flat while the dataset grows", async ({ page }) => {
    await serveFeed(page, [], 0);
    await page.goto("/labs/infinite-scroll");

    await expect(page.getByTestId("stat-items")).toHaveText("50");
    const initialRows = await renderedRows(page).count();
    // A 480px window over ~60px rows: tens of rows, not fifties.
    expect(initialRows).toBeLessThan(30);

    await expect
      .poll(
        async () => {
          await scrollBy(page, 3_000);
          return Number(await page.getByTestId("stat-items").textContent());
        },
        { timeout: 40_000, message: "the feed never reached 300 rows" },
      )
      .toBeGreaterThanOrEqual(300);

    // 300+ rows loaded, and the DOM holds the same handful it started with.
    expect(await renderedRows(page).count()).toBeLessThan(30);
  });

  test("gives the scroll range the whole dataset, not just the rendered rows", async ({ page }) => {
    await serveFeed(page, [], 0);
    await page.goto("/labs/infinite-scroll");
    await expect(page.getByTestId("stat-items")).toHaveText("50");

    const { scrollHeight, clientHeight } = await container(page).evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));

    // The spacer is real even though most of the rows inside it are not.
    expect(scrollHeight).toBeGreaterThan(clientHeight * 4);
  });

  test("the eager arm requests the next page before the end is reached", async ({ page }) => {
    const cursors: number[] = [];
    await serveFeed(page, cursors);
    await page.goto("/labs/infinite-scroll?prefetch=eager");
    await expect(page.getByTestId("stat-items")).toHaveText("50");
    expect(pagesAsked(cursors)).toEqual([0]);

    // Stop 400px short of the end of the loaded range. The 600px margin has
    // been crossed; against the default root (the viewport) it would not have
    // been, which is the mistake the root choice exists to avoid.
    await scrollBy(page, (await remainingScroll(page)) - 400);

    await expect.poll(() => pagesAsked(cursors), { timeout: 10_000 }).toEqual([0, PAGE_SIZE]);
  });

  test("the zero-margin arm asks only once the bottom is reached", async ({ page }) => {
    const cursors: number[] = [];
    await serveFeed(page, cursors, 400);
    await page.goto("/labs/infinite-scroll?prefetch=end");
    await expect(page.getByTestId("stat-items")).toHaveText("50");

    const remaining = await remainingScroll(page);
    await scrollBy(page, remaining - 400);

    // The same scroll position that made the eager arm fetch. 400px short of
    // the end is not the end, so nothing has been asked for.
    expect(pagesAsked(cursors)).toEqual([0]);

    await scrollBy(page, 400);

    // Arriving is what starts the request, so the spinner is unavoidable.
    // That is the entire difference between the two arms.
    await expect(status(page)).toHaveText("Loading more…");
    await expect.poll(() => pagesAsked(cursors), { timeout: 10_000 }).toEqual([0, PAGE_SIZE]);
  });

  test("keeps loading when a page lands with the sentinel still in view", async ({ page }) => {
    // The stall a callback-driven observer produces. Five-row pages are far
    // shorter than the 600px prefetch margin, so a landed page leaves the
    // sentinel still inside the margin: no intersection transition occurs, and
    // an implementation listening for one stops dead after the second page,
    // with the list showing 10 of 40 rows and nothing to indicate why.
    //
    // Driving from intersection *state* keeps the chain going instead, and it
    // stops for the right reason rather than not at all: once the loaded rows
    // are taller than the window plus the margin, the sentinel genuinely is
    // out of range and there is nothing more to prefetch until the user moves.
    // That settling point is a function of the row height, so the assertion is
    // "several pages past where a transition-driven version dies", not an
    // exact count. Scrolling then resumes it.
    const cursors: number[] = [];
    await page.route(isFeedRequest, async (route: Route) => {
      const url = new URL(route.request().url());
      const cursor = Number(url.searchParams.get("cursor") ?? 0);
      cursors.push(cursor);
      const end = Math.min(cursor + 5, 40);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: Array.from({ length: end - cursor }, (_, i) => feedItem(cursor + i)),
          nextCursor: end < 40 ? String(end) : null,
          total: 40,
        }),
      });
    });

    await page.goto("/labs/infinite-scroll?prefetch=eager");

    // Not one scroll gesture, and well past the two pages a transition-driven
    // implementation manages.
    await expect
      .poll(() => pagesAsked(cursors).length, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(4);
    await expect
      .poll(() => pagesAsked(cursors).length, { timeout: 5_000, intervals: [1_000, 1_000, 1_000] })
      .toBeLessThan(8);

    // It settled rather than broke: the sentinel is still there, waiting.
    await expect(page.getByTestId("prefetch-sentinel")).toHaveCount(1);
    await expect(status(page)).toHaveText("");

    // And a scroll picks the chain straight back up, to the end of the feed.
    await expect
      .poll(
        async () => {
          await scrollBy(page, 2_000);
          return Number(await page.getByTestId("stat-items").textContent());
        },
        { timeout: 30_000, message: "the feed never completed" },
      )
      .toBe(40);
    await expect(status(page)).toHaveText("All 40 items loaded");
    expect(pagesAsked(cursors)).toEqual([0, 5, 10, 15, 20, 25, 30, 35]);
  });

  test("stops asking once the feed is exhausted", async ({ page }) => {
    const cursors: number[] = [];
    await serveFeed(page, cursors, 0, 1);
    await page.goto("/labs/infinite-scroll");

    await expect(status(page)).toHaveText("All 1 items loaded");
    await scrollBy(page, 2_000);
    await scrollBy(page, 2_000);

    // The sentinel is unmounted, so there is nothing left to trip.
    await expect(page.getByTestId("prefetch-sentinel")).toHaveCount(0);
    expect(pagesAsked(cursors)).toEqual([0]);
  });
});
