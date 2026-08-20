/**
 * The one polymorphic-button claim the unit suite cannot check.
 *
 * `Button` renders "disabled" two different ways depending on what `as`
 * resolved to: the real attribute on a `<button>`, and `aria-disabled` plus a
 * click interceptor on anything that has no such attribute. The interesting
 * half is the second one, and what actually matters about it is whether the
 * browser still navigates — which is exactly what jsdom cannot answer. jsdom
 * implements no navigation at all: clicking an `<a href>` there logs "Not
 * implemented: navigation to another Document" and the location never
 * changes, so a jsdom test passes whether or not `preventDefault` was ever
 * called. The unit tests assert the handler and the attributes; this asserts
 * the outcome.
 *
 * Every disabled click here is a `force` click, and that is not a workaround
 * for a flaky selector. Playwright's own actionability check treats
 * `aria-disabled="true"` as not-enabled and refuses to click it — useful
 * corroboration that the attribute is doing its job, and also a check that
 * would pass with no click interceptor at all, because it never gets as far as
 * dispatching an event. `force` skips that check and puts a real click on the
 * element, which is what a determined user does and what the interceptor
 * exists for.
 */

import { test, expect } from "@playwright/test";

test.describe("polymorphic Button — disabled on elements with no disabled attribute", () => {
  test("announces disabled through ARIA rather than the inert attribute", async ({ page }) => {
    await page.goto("/labs/polymorphic");

    for (const name of ["Anchor", "Router Link"]) {
      const link = page.getByRole("link", { name });
      await expect(link).toHaveAttribute("aria-disabled", "true");
      // The attribute a naive implementation would have forwarded, and which
      // the browser would then have ignored entirely.
      await expect(link).not.toHaveAttribute("disabled", /.*/);
      // Playwright reads `aria-disabled` as disabled, so assistive tooling
      // agrees with the styling.
      await expect(link).toBeDisabled();
    }
  });

  test("a disabled router Link does not navigate when clicked anyway", async ({ page }) => {
    await page.goto("/labs/polymorphic");

    await page.getByRole("link", { name: "Router Link" }).click({ force: true });

    await expect(page).toHaveURL(/\/labs\/polymorphic$/);
    await expect(page.getByRole("heading", { name: "Polymorphic Lab" })).toBeVisible();
  });

  test("a disabled anchor does not run its handler when clicked anyway", async ({ page }) => {
    await page.goto("/labs/polymorphic");

    await expect(page.getByTestId("click-count")).toHaveText("0");
    await page.getByRole("link", { name: "Anchor" }).click({ force: true });
    await page.getByRole("button", { name: "Native button" }).click({ force: true });

    await expect(page.getByTestId("click-count")).toHaveText("0");
  });

  test("the same controls work once they are enabled", async ({ page }) => {
    await page.goto("/labs/polymorphic");
    await page.getByRole("checkbox", { name: "Disable all three" }).uncheck();

    await page.getByRole("button", { name: "Native button" }).click();
    await page.getByRole("link", { name: "Anchor" }).click();
    await expect(page.getByTestId("click-count")).toHaveText("2");

    // And the router link navigates for real, which is the whole reason a
    // navigating control should be an anchor rather than a button.
    await page.getByRole("link", { name: "Router Link" }).click();
    await expect(page).toHaveURL(/\/about$/);
  });
});
