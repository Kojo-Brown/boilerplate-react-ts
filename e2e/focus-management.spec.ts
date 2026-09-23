/**
 * Skip link, route announcement and drawer trap, in a real browser.
 *
 * The unit suite pins all three against jsdom, which does no layout and has no
 * sequential focus navigation of its own: `userEvent.tab()` walks a list that
 * testing-library computes, so a test can pass there against a tab order the
 * browser would never produce. Everything here is a question only a real
 * engine answers — where Tab actually goes, whether `sr-only` really leaves an
 * element focusable, whether `inert` really takes a subtree out of the order.
 */

import { test, expect, type Page } from "@playwright/test";

const SKIP_LINK = "Skip to main content";
/** Narrow enough for the `md:` breakpoint to put the sidebar behind its toggle. */
const PHONE = { width: 390, height: 844 };

/** True when focus is somewhere inside the element `selector` names. */
async function focusIsInside(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    const active = document.activeElement;
    return root !== null && active !== null && root.contains(active);
  }, selector);
}

test.describe("skip link", () => {
  test("is clipped until it has focus, and focusable throughout", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const link = page.getByRole("link", { name: SKIP_LINK });
    // `sr-only` clips the element to a 1px box rather than removing it, and
    // that distinction is the entire mechanism: `display: none` would make it
    // unfocusable and therefore useless.
    const clipped = await link.boundingBox();
    expect(clipped?.width).toBeLessThanOrEqual(1);

    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();

    // On screen now: the people this link helps most are sighted keyboard
    // users, who need to see where the offer is.
    const revealed = await link.boundingBox();
    expect(revealed?.width ?? 0).toBeGreaterThan(50);
  });

  test("moves focus into main without adding a fragment to the URL", async ({ page }) => {
    await page.goto("/about");
    await expect(page.getByRole("heading", { level: 1, name: "About" })).toBeVisible();
    const urlBefore = page.url();

    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");

    await expect(page.locator("main#main-content")).toBeFocused();
    // A `#main-content` left here outlives the click: it is copied with the
    // URL and read by `<ScrollRestoration>` on every later navigation.
    expect(page.url()).toBe(urlBefore);
  });

  test("puts the page content next in the tab order", async ({ page }) => {
    // The claim jsdom cannot check: after landing on `<main tabindex="-1">`,
    // the next Tab continues *inside* it rather than resuming at the header.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");

    expect(await focusIsInside(page, "main#main-content")).toBe(true);
  });
});

test.describe("route change", () => {
  test("announces the page that arrived and retitles the tab", async ({ page }) => {
    await page.goto("/");
    const announcer = page.getByTestId("route-announcer");
    // Empty on arrival: a document load is announced by the browser itself,
    // and saying it again talks over that.
    await expect(announcer).toHaveText("");

    await page.getByRole("link", { name: "About", exact: true }).first().click();

    await expect(announcer).toHaveText("About, page loaded");
    await expect(page).toHaveTitle("About · React TS");
  });

  test("moves focus to the main landmark", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "About", exact: true }).first().click();

    await expect(page.getByRole("heading", { level: 1, name: "About" })).toBeVisible();
    await expect(page.locator("main#main-content")).toBeFocused();
  });

  test("announces a Back navigation too", async ({ page }) => {
    // Back is the case `useRef(true)`-style "first render" flags get wrong in
    // the other direction, and the one where focus must not drag the scroll
    // position away from where the router just restored it.
    await page.goto("/");
    await page.getByRole("link", { name: "About", exact: true }).first().click();
    await expect(page.getByTestId("route-announcer")).toHaveText("About, page loaded");

    await page.goBack();

    // "Home", not the page's `<h1>`: the handle names the page the way the
    // navigation does, which is the name a user is looking for.
    await expect(page.getByTestId("route-announcer")).toHaveText("Home, page loaded");
    await expect(page.locator("main#main-content")).toBeFocused();
  });
});

test.describe("sidebar drawer", () => {
  test.use({ viewport: PHONE });

  test("is not in the tab order while it is closed", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // `inert` is what makes this true. A `-translate-x-full` moves the drawer
    // off screen and removes nothing from the tab order, so without it a phone
    // user Tabbing out of the header falls into three links they cannot see.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await focusIsInside(page, "aside"), `tab ${String(i + 1)} entered the drawer`).toBe(
        false,
      );
    }
  });

  test("traps Tab while it is open and hands focus back on Escape", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Toggle sidebar" });
    await toggle.click();

    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    // Opening moved focus inside, to the first link.
    await expect(drawer.getByRole("link", { name: "Home" })).toBeFocused();

    // Three links, so the third Tab is the wrap. Focus staying inside across
    // all of them is the trap; a page behind that is merely covered would have
    // taken the fourth.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      expect(await focusIsInside(page, "aside"), `tab ${String(i + 1)} left the drawer`).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    // Back on the control that opened it, not on `<body>` — from `<body>`, the
    // next Tab restarts at the top of the document.
    await expect(toggle).toBeFocused();
  });

  test("pulls focus back when something outside takes it", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();

    // A programmatic focus from the page behind: the escape route no amount of
    // Tab interception can see, and the reason there is a `focusin` listener.
    await page.evaluate(() => {
      document.querySelector<HTMLElement>("header a")?.focus();
    });

    expect(await focusIsInside(page, "aside")).toBe(true);
  });
});
