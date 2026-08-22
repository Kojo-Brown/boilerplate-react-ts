/**
 * The one claim about the three deliveries that the unit suite cannot make.
 *
 * jsdom implements no media queries at all — `src/test/matchMedia.ts` installs
 * a stub because the API is simply absent — so every unit test here answers
 * from a harness that the tests themselves control. That is the right tool for
 * asserting *how many times* something subscribed, and it is worthless for
 * asserting that a subscription tracks a real viewport: the harness would
 * report whatever it was told to report even if `useMediaQuery` ignored the
 * browser entirely.
 *
 * A real browser resize is the only way to check the actual claim, which is
 * that the hook, the render prop and the HOC are one subscription wearing
 * three coats and therefore cannot disagree.
 */

import { test, expect, type Page } from "@playwright/test";

const CARDS = ["hook", "render-prop", "hoc"] as const;

async function expectAllCards(page: Page, matches: "true" | "false"): Promise<void> {
  for (const source of CARDS) {
    await expect(page.getByTestId(`card-${source}`)).toHaveAttribute("data-matches", matches);
  }
}

test.describe("render-props lab — one subscription, three deliveries", () => {
  test("all three agree as the viewport crosses the breakpoint", async ({ page }) => {
    // 48rem is 768px at the default root font size. Either side of it, not on
    // it: `(min-width: 48rem)` is inclusive, so 768 exactly would be asserting
    // the boundary condition rather than the behaviour.
    await page.setViewportSize({ width: 640, height: 800 });
    await page.goto("/labs/render-props");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Render Props & HOCs Lab");
    await expectAllCards(page, "false");

    await page.setViewportSize({ width: 1024, height: 800 });
    await expectAllCards(page, "true");

    await page.setViewportSize({ width: 640, height: 800 });
    await expectAllCards(page, "false");
  });

  test("switching the query re-points all three at the new one", async ({ page }) => {
    // Between the two breakpoints: ≥ 48rem matches here and ≥ 64rem (1024px)
    // does not, so the two queries have different answers at one viewport and
    // the switch is observable without resizing again.
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto("/labs/render-props");

    await expectAllCards(page, "true");

    await page.getByRole("button", { name: "≥ 64rem" }).click();

    await expect(page.getByTestId("chosen-query")).toHaveText("(min-width: 64rem)");
    await expectAllCards(page, "false");
  });

  test("a wrapper built during render loses its subtree's state", async ({ page }) => {
    /*
     * The HOC defect, in a real browser rather than in jsdom's simulation of
     * one. Both counters are the same component behind the same HOC; only the
     * placement of the `withMediaQuery` call differs.
     */
    await page.goto("/labs/render-props");

    await page.getByTestId("count-module-scope").click();
    await page.getByTestId("count-module-scope").click();
    await page.getByTestId("count-created-in-render").click();

    await expect(page.getByTestId("count-module-scope")).toHaveText("clicked 2×");
    await expect(page.getByTestId("count-created-in-render")).toHaveText("clicked 1×");

    await page.getByTestId("rerender-parent").click();

    await expect(page.getByTestId("count-module-scope")).toHaveText("clicked 2×");
    await expect(page.getByTestId("count-created-in-render")).toHaveText("clicked 0×");
  });
});
