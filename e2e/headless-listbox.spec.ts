/**
 * The one listbox behaviour the unit suite cannot check.
 *
 * `aria-activedescendant` never moves real focus, so the browser never scrolls
 * the highlighted option into view — the hook has to. jsdom implements no
 * layout and does not even define `scrollIntoView`, so
 * `SelectMenu.test.tsx` can only assert that a spy was called. Whether the
 * option the user is arrowing towards actually ends up on screen is a question
 * for a real browser, and this is where it gets asked.
 *
 * `/labs/headless` renders the same list under three presentations; the
 * always-visible one is deliberately taller than its container.
 */

import { test, expect } from "@playwright/test";

test.describe("headless listbox", () => {
  test("scrolls the active option into view even though focus never moves", async ({ page }) => {
    await page.goto("/labs/headless");
    const listbox = page.getByRole("listbox", { name: "Framework (list)" });
    await expect(listbox).toBeVisible();

    // The list has to overflow, or there is nothing to prove.
    const overflows = await listbox.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(overflows).toBe(true);
    expect(await listbox.evaluate((el) => el.scrollTop)).toBe(0);

    await listbox.focus();
    await page.keyboard.press("End");

    const last = listbox.getByRole("option", { name: "Astro", exact: true });
    const lastId = await last.getAttribute("id");
    expect(lastId).not.toBeNull();
    await expect(listbox).toHaveAttribute("aria-activedescendant", lastId ?? "");
    await expect(last).toBeInViewport();
    expect(await listbox.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // Virtual focus, not a roving tab stop: the list itself still has focus.
    await expect(listbox).toBeFocused();
  });

  test("drives every skin from one behaviour hook", async ({ page }) => {
    await page.goto("/labs/headless");

    const cards = page.getByRole("listbox", { name: "Framework (cards)" });
    await cards.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("selected-framework")).toHaveText("react");
    await expect(page.getByRole("button", { name: /Framework/ })).toContainText("React");
    await expect(
      page
        .getByRole("listbox", { name: "Framework (list)" })
        .getByRole("option", { name: "React", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
  });
});
