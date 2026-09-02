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
 * - the page really being hidden is what finalises LCP, INP and CLS, and the
 *   flush has to happen in that same callback;
 * - the payload leaves as a beacon, which is the code path that survives the
 *   document going away.
 *
 * The visit is ended by navigating away rather than by dispatching a
 * `visibilitychange`: `web-vitals` finalises LCP only for a trusted event, so a
 * synthetic one produces a beacon with the LCP row silently missing — which is
 * exactly the bug this test would otherwise be written to miss.
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

/**
 * Collects every beacon the page sends.
 *
 * Observed rather than intercepted: these requests are issued while the
 * document is being torn down, and `page.route()` handlers no longer run for
 * them — the beacon simply never appears. Reading the request off the wire is
 * what makes the unload path observable at all. The collector path is not
 * served, so the dev server answers 404, which a beacon neither notices nor
 * retries.
 */
function captureBeacons(page: Page): VitalsRow[] {
  const rows: VitalsRow[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/__vitals")) return;
    const body = request.postData() ?? '{"events":[]}';
    rows.push(...(JSON.parse(body) as { events: VitalsRow[] }).events);
  });
  return rows;
}

test("reports the three Core Web Vitals when the visit ends", async ({ page }) => {
  const rows = captureBeacons(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "React TS Boilerplate" })).toBeVisible();

  // A real click, which is what gives INP an interaction to measure, and a
  // client-side navigation, which is what makes route attribution meaningful.
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
  // still open, so a sink that reported eagerly would report the wrong numbers.
  expect(rows).toHaveLength(0);

  await page.goto("about:blank");
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
