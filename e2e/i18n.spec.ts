import { test, expect } from "@playwright/test";

/**
 * What only a real browser can answer about the i18n layer.
 *
 * The unit suite already covers the catalogues, the negotiation, the provider
 * and the lab's own output — all of it in jsdom, which has full ICU and a real
 * `Intl`. Three things it cannot cover, and they are what this file is for:
 *
 * 1. **`<html dir>` actually mirrors the layout.** jsdom parses CSS and lays out
 *    nothing, so a `margin-inline-start` there is a string. Here the sidebar's
 *    position is measured, which is the only assertion that can fail if a
 *    physical side survives the lint rule — an inline style, a third-party
 *    component, a `style` prop.
 * 2. **The language survives a reload.** The preference is in `localStorage` and
 *    read before the first render; a test that renders a provider cannot see the
 *    load path that reads it.
 * 3. **The catalogue is a separate chunk.** The whole reason non-default locales
 *    are `import()`ed is that they are not in the initial bundle, and only a
 *    browser can be asked what it downloaded.
 */

const LOCALE_SELECT = "combobox";

test.describe("internationalisation", () => {
  test("starts in English and switches to Arabic", async ({ page }) => {
    await page.goto("/labs/i18n");

    const root = page.locator("html");
    await expect(root).toHaveAttribute("lang", "en-GB");
    await expect(root).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Internationalisation");

    await page.getByRole(LOCALE_SELECT).selectOption("ar-EG");

    await expect(root).toHaveAttribute("lang", "ar-EG");
    await expect(root).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("التدويل");
  });

  test("mirrors the layout rather than restyling it", async ({ page }) => {
    /*
     * The assertion the lint rule exists to protect. The sidebar is anchored to
     * the inline-start edge with `start-0`, so in a left-to-right document it is
     * against the left edge of the viewport and in a right-to-left one it is
     * against the right — with no second stylesheet, no `[dir=rtl]` block and
     * nothing conditional in the component.
     *
     * Measured rather than asserted on a class name, because a class name is
     * what the unit test can already see. What a browser adds is whether the
     * pixels moved.
     */
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    const sidebar = page.getByRole("complementary");
    const before = await sidebar.boundingBox();
    expect(before).not.toBeNull();
    expect(before?.x).toBeLessThan(100);

    await page.getByRole(LOCALE_SELECT).selectOption("ar-EG");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    const after = await sidebar.boundingBox();
    expect(after).not.toBeNull();
    // Against the far edge now: its left coordinate is past the middle of a
    // 1280px viewport, which is only true if the document mirrored.
    expect(after?.x).toBeGreaterThan(640);
  });

  test("remembers the choice across a reload", async ({ page }) => {
    await page.goto("/labs/i18n");
    await page.getByRole(LOCALE_SELECT).selectOption("ar-EG");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    await page.reload();

    // Read before the first render, so there is no frame of English — which is
    // what the `resolveI18n()` await in `main.tsx` buys and what a provider that
    // negotiated internally could not.
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("التدويل");
  });

  test("negotiates from the browser's languages on a first visit", async ({ browser }) => {
    const context = await browser.newContext({ locale: "ar-EG" });
    const page = await context.newPage();

    await page.goto("/labs/i18n");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    await context.close();
  });

  test("titles the tab in the reader's language", async ({ page }) => {
    // `document.title` is the one piece of the page a reader keeps seeing after
    // they navigate away from it, which is why the announcer's title effect
    // depends on `intl` and its announcement effect does not.
    await page.goto("/about");
    await expect(page).toHaveTitle(/^About · /);

    await page.getByRole(LOCALE_SELECT).selectOption("ar-EG");
    await expect(page).toHaveTitle(/^حول · /);
  });

  test("does not ship a non-default catalogue until it is asked for", async ({ page }) => {
    /*
     * The bundle claim, checked rather than asserted in a comment. Every
     * non-default catalogue is an `import()` so that adding a language costs the
     * initial bundle nothing — a promise that is easy to make and easy to break,
     * because one static import from a module the entry reaches undoes it
     * silently.
     */
    const chunkRequests: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (/ar-EG|arEG/.test(url)) chunkRequests.push(url);
    });

    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    expect(chunkRequests, "Arabic catalogue requested before it was asked for").toEqual([]);

    await page.getByRole(LOCALE_SELECT).selectOption("ar-EG");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    expect(chunkRequests.length).toBeGreaterThan(0);
  });

  test("announces the change in the language it changed to", async ({ page }) => {
    // A switch replaces every string on the page. Without an announcement a
    // screen-reader user is told none of it, and the next thing they hear is in a
    // language that was not the one they were reading.
    await page.goto("/labs/i18n");
    await page.getByRole(LOCALE_SELECT).selectOption("ar-EG");

    await expect(page.getByTestId("live-regions")).toContainText("تم تغيير اللغة إلى العربية");
  });
});
