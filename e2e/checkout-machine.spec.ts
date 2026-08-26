/**
 * The claims about the checkout machine that a jsdom test cannot make.
 *
 * Most of this machine is pure and is asserted directly against the actor in
 * `src/features/checkout/checkoutMachine.test.ts`, which is the right place for it —
 * an actor test does not need a DOM to prove that `submitting` has no
 * `order.place` transition.
 *
 * Two things are different in a browser and are here for that reason.
 *
 * A real double-click is one gesture, not two awaited ones. `userEvent` in
 * jsdom serialises clicks with awaits between them, so React has always
 * finished re-rendering before the second lands and the "you cannot submit
 * twice" assertion is partly being made by the test harness. `dblclick` here
 * dispatches both inside one task, against a real event loop.
 *
 * And the pending state is a *layout*: the primary button is replaced rather
 * than disabled, and the Cancel beside it has to be reachable and clickable
 * while the request is in flight. jsdom has no layout, so it cannot tell a
 * visible control from one behind an overlay.
 */

import { test, expect, type Page } from "@playwright/test";

/** Instant server unless a test needs a window to press Cancel in. */
const LAB = (query = "latency=0") => `/labs/checkout?${query}`;

async function fillDetails(page: Page): Promise<void> {
  await page.getByLabel(/Full name/).fill("Grace Hopper");
  await page.getByLabel(/Address/).fill("12 Navy Yard");
  await page.getByLabel(/Town or city/).fill("Arlington");
  await page.getByLabel(/Postcode/).fill("SW1A 1AA");
  await page.getByRole("button", { name: /continue to payment/i }).click();

  await page.getByLabel(/Name on card/).fill("G Hopper");
  // The number every payment gateway documents as a test card.
  await page.getByLabel(/Card number/).fill("4242 4242 4242 4242");
  await page.getByLabel(/Expiry/).fill("12/99");
  await page.getByLabel(/Security code/).fill("123");
  await page.getByRole("button", { name: /review order/i }).click();
}

async function reachReview(page: Page, query?: string): Promise<void> {
  await page.goto(query === undefined ? LAB() : LAB(query));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Checkout Machine Lab");
  await page.getByRole("button", { name: /continue to delivery/i }).click();
  await fillDetails(page);
  await expect(page.getByTestId("checkout-flow")).toHaveAttribute("data-state", "review");
}

test.describe("checkout machine", () => {
  test("walks the flow and confirms the order", async ({ page }) => {
    await reachReview(page);

    await page.getByTestId("place-order").click();

    await expect(page.getByTestId("order-id")).toContainText("ord-1");
    await expect(page.getByTestId("checkout-flow")).toHaveAttribute("data-state", "confirmed");
    for (const step of ["cart", "shipping", "payment", "review"]) {
      await expect(page.getByTestId(`step-${step}`)).toHaveAttribute("data-state", "done");
    }
  });

  test("a double-click places one order", async ({ page }) => {
    // Both clicks in one gesture. The second has no transition to take, so
    // there is nothing to debounce and nothing to disable.
    await reachReview(page, "latency=1500");

    await page.getByTestId("place-order").dblclick();

    await expect(page.getByTestId("placing-order")).toBeVisible();
    await expect(page.getByTestId("order-id")).toContainText("ord-1", { timeout: 10_000 });

    // The evidence, rather than the absence of evidence: order ids are
    // sequential per call that reached the fake server, so the *next* order
    // names how many the double-click actually sent. Two would make this
    // `ord-3`.
    await page.getByTestId("restart-checkout").click();
    await page.getByRole("button", { name: /continue to delivery/i }).click();
    await fillDetails(page);
    await page.getByTestId("place-order").click();

    await expect(page.getByTestId("order-id")).toContainText("ord-2", { timeout: 10_000 });
  });

  test("cancel is reachable while the order is in flight, and undoes it", async ({ page }) => {
    await reachReview(page, "latency=8000");

    await page.getByTestId("place-order").click();
    await expect(page.getByTestId("placing-order")).toBeVisible();
    await expect(page.getByTestId("place-order")).toHaveCount(0);

    await page.getByTestId("cancel-order").click();

    await expect(page.getByTestId("checkout-flow")).toHaveAttribute("data-state", "review");
    await expect(page.getByTestId("place-order")).toBeVisible();
    // Nothing arrives later: the request was aborted, not merely ignored.
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId("checkout-flow")).toHaveAttribute("data-state", "review");
  });

  test("a declined card returns to the payment step with what was typed", async ({ page }) => {
    await reachReview(page, "latency=0&server=declined");

    await page.getByTestId("place-order").click();

    await expect(page.getByTestId("checkout-flow")).toHaveAttribute("data-state", "payment");
    await expect(page.getByTestId("step-message")).toContainText("declined");
    await expect(page.getByLabel(/Card number/)).toHaveValue("4242 4242 4242 4242");
  });

  test("the running total ignores keystrokes in the address form", async ({ page }) => {
    // `useSelector` against `useMachine`: the flow re-renders on every
    // keystroke, the total does not.
    await page.goto(LAB());
    await page.getByRole("button", { name: /continue to delivery/i }).click();

    const total = page.getByTestId("live-total");
    const before = await total.getAttribute("data-commits");
    await page.getByLabel(/Town or city/).fill("Arlington");
    await expect(page.getByLabel(/Town or city/)).toHaveValue("Arlington");

    await expect(total).toHaveAttribute("data-commits", before ?? "1");
  });
});
