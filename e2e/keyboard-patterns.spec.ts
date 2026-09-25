/**
 * The keyboard claims that only a real browser can settle.
 *
 * Three of the four patterns hand part of their contract to the platform, and
 * jsdom implements none of that part:
 *
 * - **`<dialog>`.** `showModal()` does not exist in jsdom at all —
 *   `Modal.test.tsx` stubs it into an attribute change. The focus trap, the
 *   Escape key, focus restored to the opener and the inertness of everything
 *   behind the dialog are the platform's, and asserting them against a stub
 *   would be asserting the stub.
 * - **Tab's default action.** `user-event` computes its tab destination from
 *   the *event target* rather than from whatever holds focus when the default
 *   action runs. A menu that closes on Tab unmounts that target, so
 *   `user.tab()` lands on `<body>` whether or not the component restored focus
 *   first — the exact bug it would be there to catch. A browser reads the
 *   focused element, so the claim is testable here and nowhere else.
 * - **Scrolling.** A `aria-activedescendant` highlight moves nothing, so a
 *   combobox arrowing past the fold needs `scrollIntoView` to have worked, and
 *   jsdom has no layout. (`headless-listbox.spec.ts` makes the same point for
 *   the listbox.)
 *
 * Everything the unit suites *can* check — key maps, ARIA wiring, what
 * commits and what does not — stays with them. This file is deliberately
 * short.
 */

import { test, expect } from "@playwright/test";

test.describe("keyboard patterns", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/labs/keyboard");
    await expect(page.getByRole("heading", { level: 1, name: "Keyboard Lab" })).toBeVisible();
  });

  test.describe("dialog", () => {
    test("traps Tab, closes on Escape and gives focus back to the opener", async ({ page }) => {
      const opener = page.getByRole("button", { name: "Open dialog" });
      await opener.click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      // Focus starts on the title, not on the close button the platform would
      // otherwise pick — the one part of this that is ours.
      await expect(page.getByRole("heading", { name: "Rename this project" })).toBeFocused();

      /*
       * Tab all the way round twice. With `showModal()` the top layer makes
       * the rest of the document inert, so no control on the page behind can
       * take focus however many times Tab is pressed — and that, rather than
       * anything in this repository, is the claim.
       *
       * The assertion is "never lands on something outside the dialog" and not
       * the tighter "always inside the dialog", because Chromium's cycle
       * passes through `document.body` at the wrap point: the dialog's last
       * control, then `<body>`, then back to the dialog's first. That stop is
       * where focus would go to the browser's own UI in a headed window. It is
       * not an escape — there is nothing on it to operate and the next Tab is
       * back inside — but a test that demands `inDialog` on every press fails
       * on the fourth, against a trap that is working.
       */
      const landings: string[] = [];
      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press("Tab");
        landings.push(
          await page.evaluate(() => {
            const active = document.activeElement;
            if (active === null || active === document.body) return "body";
            return document.querySelector("dialog")?.contains(active) === true
              ? "dialog"
              : // Named rather than lumped in with the two expected landings, so
                // a failure says what focus escaped onto.
                `outside: ${active.tagName}`;
          }),
        );
      }
      expect(new Set(landings)).toEqual(new Set(["dialog", "body"]));
      // And it really did cycle rather than park somewhere.
      expect(landings.filter((where) => where === "dialog").length).toBeGreaterThan(4);

      await page.keyboard.press("Escape");

      await expect(dialog).toBeHidden();
      await expect(opener).toBeFocused();
    });
  });

  test.describe("menu", () => {
    test.beforeEach(async ({ page }) => {
      await page.getByRole("tab", { name: "Menu" }).click();
    });

    test("Tab closes the menu and continues the tab order from the trigger", async ({ page }) => {
      const trigger = page.getByRole("button", { name: "Row actions" });
      await trigger.focus();
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("menuitem", { name: "Rename" })).toBeFocused();

      await page.keyboard.press("Tab");

      await expect(page.getByRole("menu")).toBeHidden();
      /*
       * The regression: closing without restoring focus first leaves the
       * browser resolving Tab against an item that is being unmounted, focus
       * falls to `<body>`, and the next Tab restarts at the top of the
       * document. Focus should be *past* the trigger, not on it and not lost.
       */
      const landedOnBody = await page.evaluate(
        () => document.activeElement === document.body || document.activeElement === null,
      );
      expect(landedOnBody).toBe(false);
      await expect(trigger).not.toBeFocused();
    });

    test("Escape closes it and puts focus back on the trigger", async ({ page }) => {
      const trigger = page.getByRole("button", { name: "Row actions" });
      await trigger.focus();
      await page.keyboard.press("ArrowUp");
      await expect(page.getByRole("menuitem", { name: "Delete" })).toBeFocused();

      await page.keyboard.press("Escape");

      await expect(page.getByRole("menu")).toBeHidden();
      await expect(trigger).toBeFocused();
    });

    test("Space runs the focused command rather than being eaten by typeahead", async ({
      page,
    }) => {
      await page.getByRole("button", { name: "Row actions" }).focus();
      await page.keyboard.press("ArrowDown");

      await page.keyboard.press("Space");

      // A menu item is a real button, so Space activates it on keyup — which a
      // typeahead handler that prevents the default silently cancels.
      await expect(page.getByTestId("last-command")).toHaveText("rename");
    });
  });

  test.describe("combobox", () => {
    test.beforeEach(async ({ page }) => {
      await page.getByRole("tab", { name: "Combobox" }).click();
    });

    test("scrolls the highlighted option into view although focus never moves", async ({
      page,
    }) => {
      const input = page.getByRole("combobox", { name: /destination \(combobox\)/i });
      await input.click();
      await page.keyboard.press("ArrowDown");

      const listbox = page.getByRole("listbox", { name: /destination \(combobox\)/i });
      await expect(listbox).toBeVisible();
      const overflows = await listbox.evaluate((el) => el.scrollHeight > el.clientHeight);
      expect(overflows, "the popup has to overflow or there is nothing to prove").toBe(true);

      await page.keyboard.press("End");
      // End belongs to the caret here, so the highlight has to be walked down.
      for (let i = 0; i < 12; i += 1) await page.keyboard.press("ArrowDown");

      const last = listbox.getByRole("option", { name: "Zürich" });
      await expect(input).toHaveAttribute(
        "aria-activedescendant",
        (await last.getAttribute("id")) ?? "",
      );
      await expect(last).toBeInViewport();
      // Focus never left the textbox — that is the whole reason the scroll had
      // to be done by hand.
      await expect(input).toBeFocused();
    });

    test("Home and End move the caret rather than the highlight", async ({ page }) => {
      const input = page.getByRole("combobox", { name: /destination \(combobox\)/i });
      await input.click();
      await page.keyboard.type("new");
      await page.keyboard.press("ArrowDown");

      await page.keyboard.press("Home");
      await page.keyboard.type("X");

      await expect(input).toHaveValue("Xnew");
    });
  });
});
