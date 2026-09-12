/**
 * The half of the error pipeline jsdom cannot supply.
 *
 * `src/shared/observability/*` and `src/features/route-errors/*` cover the
 * shaping, the classification and the boundary's own behaviour against
 * fixtures. What needs a real browser is everything downstream of the
 * boundary's decision:
 *
 * - the event actually leaves, as a `navigator.sendBeacon` request that jsdom
 *   does not implement;
 * - a stale chunk is a *real* failed dynamic import, not a `TypeError` whose
 *   message the lab happens to have written — the engine composes that message
 *   itself, and it is the thing `isChunkLoadError` keys on, so this is the only
 *   place the classifier is tested against the string it exists to match;
 * - the shell survives a route throwing, in a document with real navigation.
 *
 * The chunk test runs in Chromium only, because the message it asserts on is
 * per-engine — matching Firefox's and WebKit's spellings is done in the unit
 * suite, where all three can be written down. The rest runs everywhere.
 */

import { test, expect, type Page, type Request } from "@playwright/test";

const LAB = "/labs/errors";

interface ReportedEvent {
  eventId: string;
  level: string;
  exception: { type: string; value: string; stack?: string }[];
  fingerprint: string[];
  tags: Record<string, string>;
  contexts: { react?: { componentStack: string } };
  breadcrumbs: { category: string; message: string }[];
  mechanism: { type: string; handled: boolean };
}

/** Stands in for the collector, and answers so nothing is left pending. */
async function captureReports(page: Page): Promise<ReportedEvent[]> {
  const events: ReportedEvent[] = [];
  await page.route("**/__errors", async (route, request: Request) => {
    const body = request.postData();
    if (body !== null) events.push(JSON.parse(body) as ReportedEvent);
    await route.fulfill({ status: 204, body: "" });
  });
  return events;
}

test.describe("per-route error boundaries", () => {
  test("a broken route leaves the shell and its siblings usable", async ({ page }) => {
    await page.goto(`${LAB}?mode=deterministic`);

    await expect(page.getByTestId("route-error")).toBeVisible();
    // The nav is outside the boundary, so it is still there — which is the
    // whole difference between a per-route boundary and one at the layout.
    await expect(page.getByRole("navigation").first()).toBeVisible();
    await expect(page.getByTestId("mode-none")).toBeEnabled();
  });

  test("navigating away clears the error rather than carrying it to the next page", async ({
    page,
  }) => {
    await page.goto(`${LAB}?mode=deterministic`);
    await expect(page.getByTestId("route-error")).toBeVisible();

    // Changing the mode is a navigation, so `location.key` changes and the
    // boundary's reset keys clear it. Without them this instance — the same
    // one, reconciled at the Outlet slot — would still be showing the error.
    await page.getByTestId("mode-none").click();

    await expect(page.getByTestId("route-error")).toBeHidden();
    await expect(page.getByTestId("lab-subject")).toBeVisible();
  });

  test("retry recovers a transient failure in place", async ({ page }) => {
    await page.goto(`${LAB}?mode=render`);
    await expect(page.getByTestId("route-error")).toBeVisible();

    await page.getByTestId("lab-heal").click();
    await page.getByTestId("route-error-retry").click();

    await expect(page.getByTestId("lab-subject")).toBeVisible();
    await expect(page.getByTestId("lab-subject")).toContainText("Recovered on attempt 1");
  });

  test("retry gives up on a deterministic failure and offers a reload", async ({ page }) => {
    await page.goto(`${LAB}?mode=deterministic`);

    await page.getByTestId("route-error-retry").click();
    await expect(page.getByTestId("route-error-retry")).toBeVisible();
    await page.getByTestId("route-error-retry").click();

    await expect(page.getByTestId("route-error-retry")).toBeHidden();
    await expect(page.getByTestId("route-error-reload")).toBeVisible();
  });

  /*
   * Note what is deliberately *not* asserted through the lab: the beacon.
   *
   * `ErrorLabPage` publishes its own reporter over a memory transport, nested
   * inside the application's, so that the failures it throws on purpose are
   * never posted to a real collector. That is the right behaviour for a lab
   * and it means the lab can say nothing about the transport — the reporting
   * assertions below drive a route on the application's own reporter instead.
   * Getting this wrong is what the first version of this file did, and it
   * failed rather than quietly asserting on an empty array.
   */
});

test.describe("a genuinely stale chunk", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "The failure message is composed by the engine and differs per engine; the other spellings are covered in the unit suite.",
  );

  test("is classified from the engine's own message and offered only a reload", async ({
    page,
  }) => {
    /*
     * A real failed dynamic import, which is what a deploy during an open tab
     * produces: the document names a hashed chunk the server no longer has.
     * The route is aborted rather than answered with a 404 because Vite's dev
     * server rewrites unknown module requests, and a 200 of HTML would fail at
     * the MIME check instead — also a chunk error, but a different message.
     */
    await page.route("**/ImageLabPage*.js", (route) => route.abort("failed"));
    await page.route("**/src/pages/image-lab/**", (route) => route.abort("failed"));

    await page.goto("/labs/images");

    const fallback = page.getByTestId("route-error");
    await expect(fallback).toBeVisible();
    // Classified without the test telling it what the error was.
    await expect(fallback).toHaveAttribute("data-kind", "chunk-load");
    await expect(page.getByTestId("route-error-retry")).toBeHidden();
    await expect(page.getByTestId("route-error-reload")).toBeVisible();
    await expect(fallback).toContainText("updated while this tab was open");
  });

  test("reaches the collector as a beacon, tagged with the route and release", async ({ page }) => {
    // The one assertion that needs a real browser end to end: jsdom implements
    // no `navigator.sendBeacon`, so the unit suite stops at the transport's
    // seam and this is the only place the request itself is observed.
    const events = await captureReports(page);
    await page.route("**/ImageLabPage*.js", (route) => route.abort("failed"));
    await page.route("**/src/pages/image-lab/**", (route) => route.abort("failed"));

    await page.goto("/labs/images");
    await expect(page.getByTestId("route-error")).toBeVisible();

    await expect.poll(() => events.length).toBeGreaterThan(0);
    const event = events[0];
    expect(event?.tags["error.kind"]).toBe("chunk-load");
    expect(event?.tags["route"]).toBe("/labs/images");
    expect(event?.tags["release"]).toBe("e2e-test-build");
    expect(event?.mechanism).toEqual({ type: "route-boundary", handled: true });
    expect(event?.contexts.react?.componentStack).toBeTruthy();
  });

  test("shows the user the same id that was sent", async ({ page }) => {
    const events = await captureReports(page);
    await page.route("**/ImageLabPage*.js", (route) => route.abort("failed"));
    await page.route("**/src/pages/image-lab/**", (route) => route.abort("failed"));

    await page.goto("/labs/images");
    const shown = await page.getByTestId("route-error-event-id").textContent();

    await expect.poll(() => events.length).toBeGreaterThan(0);
    expect(shown).toBeTruthy();
    expect(events[0]?.eventId.startsWith(shown ?? "never")).toBe(true);
  });

  test("carries the breadcrumbs from before the navigation that failed", async ({ page }) => {
    /*
     * The chunk is aborted *after* the first page has loaded, so the failure
     * happens on a client-side navigation and the trail collected before it
     * is still in the ring. A `page.goto` would start a new document, and a
     * new document has an empty trail — which is exactly the difference
     * between a breadcrumb buffer that outlives navigations and one that does
     * not.
     */
    const events = await captureReports(page);
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();

    await page.route("**/AboutPage*.js", (route) => route.abort("failed"));
    await page.route("**/src/pages/about/**", (route) => route.abort("failed"));
    await page.getByRole("navigation", { name: "Main navigation" }).getByText("About").click();

    await expect(page.getByTestId("route-error")).toBeVisible();
    await expect.poll(() => events.length).toBeGreaterThan(0);

    const crumbs = events[0]?.breadcrumbs ?? [];
    expect(crumbs.some((c) => c.category === "ui.click" && c.message.includes("About"))).toBe(true);
    expect(events[0]?.tags["route"]).toBe("/about");
  });
});
