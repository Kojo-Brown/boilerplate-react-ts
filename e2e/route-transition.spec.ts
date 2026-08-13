/**
 * The held route transition, in a real browser.
 *
 * The unit suite pins the React behaviour with a chunk it gates by hand. This
 * checks the thing that gating cannot: that a real navigation, over a real
 * route, through the app's real link components, leaves the page you were on
 * visible and usable while the next one loads.
 *
 * Both arms use `/labs/navigation`, which navigates to a deliberately slow
 * route under either boundary placement.
 */

import { test, expect, type Page } from "@playwright/test";

/** Long enough to assert against comfortably, short enough not to pad the run. */
const LATENCY_MS = 4_000;
/** The slow route's own latency plus room for the chunk and CI's mood. */
const ARRIVAL_TIMEOUT_MS = 30_000;

function labUrl(boundary: "hoisted" | "per-route"): string {
  return `/labs/navigation?boundary=${boundary}&latency=${String(LATENCY_MS)}`;
}

async function startSlowNavigation(page: Page, boundary: "hoisted" | "per-route"): Promise<void> {
  await page.goto(labUrl(boundary));
  await expect(page.getByRole("heading", { level: 1, name: "Route Transition Lab" })).toBeVisible();
  await page.getByTestId("open-slow-route").click();
}

test.describe("held route transitions", () => {
  test("keeps the previous page visible and interactive while the next route loads", async ({
    page,
  }) => {
    await startSlowNavigation(page, "hoisted");

    // Still the old page. This is the whole feature: no skeleton, no blank.
    await expect(
      page.getByRole("heading", { level: 1, name: "Route Transition Lab" }),
    ).toBeVisible();

    // ...and still live, which a screenshot could not tell us. A frozen page
    // would look exactly the same right up to the moment you clicked it.
    const probe = page.getByTestId("interactivity-probe");
    await expect(probe).toHaveText("Clicked 0 times");
    await probe.click();
    await probe.click();
    await expect(probe).toHaveText("Clicked 2 times");

    await expect(page.getByRole("heading", { level: 1, name: "Slow route" })).toBeVisible({
      timeout: ARRIVAL_TIMEOUT_MS,
    });
  });

  test("shows a pending indicator for the whole hold", async ({ page }) => {
    // Without this the hold is indistinguishable from the app ignoring the
    // click, which is a worse failure than the skeleton it replaces.
    await startSlowNavigation(page, "hoisted");

    await expect(page.getByTestId("route-pending-bar")).toHaveAttribute("data-pending", "true");
    await expect(page.getByRole("status")).toHaveText(/Loading \/labs\/navigation\/slow/);
    await expect(page.getByTestId("pending-readout")).toContainText("this page is being held");

    await expect(page.getByRole("heading", { level: 1, name: "Slow route" })).toBeVisible({
      timeout: ARRIVAL_TIMEOUT_MS,
    });
    await expect(page.getByTestId("route-pending-bar")).toHaveAttribute("data-pending", "false");
  });

  test("loses the previous page when the destination carries its own boundary", async ({
    page,
  }) => {
    // The arm that reproduces what every route in this app used to do. It is
    // here so the comparison is demonstrated rather than asserted.
    await startSlowNavigation(page, "per-route");

    await expect(page.getByRole("status", { name: "Loading page" })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Route Transition Lab" }),
    ).toBeHidden();

    await expect(page.getByRole("heading", { level: 1, name: "Slow route" })).toBeVisible({
      timeout: ARRIVAL_TIMEOUT_MS,
    });
  });

  test("navigating between app routes never shows a route skeleton", async ({ page }) => {
    // The regression guard for the app itself rather than the lab: every route
    // under the layout shares one boundary, so a client navigation has no
    // skeleton to show.
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "React TS Boilerplate" }),
    ).toBeVisible();

    await page.getByRole("link", { name: "About" }).first().click();

    await expect(page.getByRole("status", { name: "Loading about page" })).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "About" })).toBeVisible();
  });
});
