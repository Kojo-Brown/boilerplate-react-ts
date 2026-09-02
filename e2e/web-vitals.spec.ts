/**
 * The half of the vitals pipeline jsdom cannot supply.
 *
 * `src/shared/analytics/*.test.ts` covers the shaping, the batching and the
 * wiring against fixtures, because jsdom implements none of the entry types
 * these metrics come from: no `largest-contentful-paint`, no `layout-shift`, no
 * `event` timing, and no `navigator.sendBeacon`. Everything asserted here needs
 * a real browser:
 *
 * - the observers actually fire, so `web-vitals` produces real values;
 * - hiding the page is what finalises INP and CLS, and the flush has to happen
 *   in that same callback;
 * - the payload leaves as a real beacon.
 *
 * Two details of how the page is hidden are load-bearing, and both were found
 * by watching this test lie:
 *
 * 1. LCP is finalised only by a *trusted* event — `finalizeLCP` checks
 *    `isTrusted` — so a synthetic `visibilitychange` yields a beacon with the
 *    LCP row silently missing. The real click below is that trusted event
 *    (`click` is one of the three LCP finalisers), which is why the click has
 *    to come first rather than being incidental to the INP assertion.
 * 2. INP and CLS report through the visibility watcher, which only asks whether
 *    the document reads hidden — so the page can be hidden *without* being
 *    unloaded. That matters: a beacon sent while the document is being torn
 *    down is not reliably deliverable on a CI runner, and this test spent a
 *    round asserting on a request that never arrived.
 *
 * LCP, INP and CLS are Chromium-only APIs, so this runs there and is skipped
 * elsewhere rather than asserting something Firefox and WebKit cannot do.
 */

import { test, expect, type Page } from "@playwright/test";

interface VitalsRow {
  metric: "LCP" | "INP" | "CLS";
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  id: string;
  path: string;
  visitId: string;
  reportedAt: number;
  navigationType: string;
  attribution: Record<string, unknown>;
}

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "LCP, INP and CLS are only implemented in Chromium.",
);

/** Stands in for the collector, and answers so nothing is left pending. */
async function captureBeacons(page: Page): Promise<VitalsRow[]> {
  const rows: VitalsRow[] = [];
  await page.route("**/__vitals", async (route) => {
    const body = route.request().postData() ?? '{"events":[]}';
    rows.push(...(JSON.parse(body) as { events: VitalsRow[] }).events);
    await route.fulfill({ status: 204, body: "" });
  });
  return rows;
}

/**
 * Hides the page without unloading it.
 *
 * `visibilityState` is read-only, so it is redefined before the event: both
 * `web-vitals`' visibility watcher and the sink's flush ask the document
 * whether it is hidden, and an event without the state change is ignored by
 * both. This is what a user backgrounding the tab looks like to the page — and
 * unlike a real tab switch, it is something a headless run can do at all.
 */
async function hidePage(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

test("reports the three Core Web Vitals when the visit ends", async ({ page }) => {
  const rows = await captureBeacons(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "React TS Boilerplate" })).toBeVisible();

  // A real click: trusted, so it finalises LCP, and an interaction, so INP has
  // something to measure. It is also a client-side navigation, which is what
  // makes route attribution meaningful.
  await page.getByRole("button", { name: "About" }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { name: "About" })).toBeVisible();

  // Waits for an idle period rather than a fixed delay. `event` timing entries
  // reach a PerformanceObserver in a later task, and INP is computed from the
  // entries the observer has actually received — leaving the page in the same
  // task as the click means there is no interaction to report yet.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestIdleCallback(() => {
          resolve();
        });
      }),
  );

  // Nothing has been sent yet: these metrics are not final while the page is
  // still visible, so a sink that reported eagerly would report the wrong
  // numbers. LCP is queued by now — queued is not sent.
  expect(rows).toHaveLength(0);

  await hidePage(page);
  await expect
    .poll(() => rows.map((row) => row.metric).sort(), { timeout: 10_000 })
    .toEqual(["CLS", "INP", "LCP"]);

  const lcp = rows.find((row) => row.metric === "LCP");
  expect(lcp?.value).toBeGreaterThan(0);
  expect(["good", "needs-improvement", "poor"]).toContain(lcp?.rating);
  expect(lcp?.navigationType).toBe("navigate");
  // The subparts are what make a slow LCP actionable rather than merely known.
  expect(lcp?.attribution).toMatchObject({
    target: expect.any(String),
    timeToFirstByteMs: expect.any(Number),
    resourceLoadDelayMs: expect.any(Number),
    resourceLoadDurationMs: expect.any(Number),
    elementRenderDelayMs: expect.any(Number),
  });

  const inp = rows.find((row) => row.metric === "INP");
  expect(inp?.value).toBeGreaterThanOrEqual(0);
  expect(inp?.attribution).toMatchObject({
    interactionType: "pointer",
    inputDelayMs: expect.any(Number),
    processingDurationMs: expect.any(Number),
    presentationDelayMs: expect.any(Number),
    loadState: expect.any(String),
  });
  // INP is finalised at page hide, by which time the SPA has moved on — so the
  // route travelling with the metric is the route it was reported from.
  expect(inp?.path).toBe("/about");

  const cls = rows.find((row) => row.metric === "CLS");
  expect(cls?.value).toBeGreaterThanOrEqual(0);

  // One page visit, however many beacons carried it, and every row identifiable
  // so the backend can dedupe on `id`.
  expect(new Set(rows.map((row) => row.visitId)).size).toBe(1);
  expect(rows.every((row) => row.id.length > 0)).toBe(true);
});
