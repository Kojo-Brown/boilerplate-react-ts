import { test, expect } from "@playwright/test";
import { ROUTES } from "@/shared/routes/paths";
import {
  AUDIT_TARGETS,
  UNREGISTERED_TARGETS,
  expectNoViolations,
  seedSession,
} from "./a11yAudit.ts";

/**
 * The WCAG 2.2 AA gate.
 *
 * Every route in the application, in both themes, with zero tolerated
 * violations — no allow-list, no rule disabled, no route excused. That
 * absolutism is the only version of this gate worth having: the moment one
 * violation is parked as "known", the count stops being a signal and the
 * suite's job becomes keeping a ledger.
 *
 * It runs against a development server with MSW answering the network, not
 * against the preview build the other specs share, and the reason is that an
 * audit of an empty page proves nothing. Half the pages here are a table, a
 * list or a form populated from a fetch; without the mocks they render their
 * loading skeleton, which passes trivially and says nothing about the content
 * a real user meets. `playwright.a11y.config.ts` owns that server.
 *
 * What it cannot see is as important as what it can. Automated rules reach
 * something like a third of the AA criteria: contrast, names, roles, structure
 * and the 2.2 additions for target size and obscured focus. They cannot judge
 * whether alt text is *accurate*, whether a focus order makes sense, or
 * whether an error message explains anything. `docs/accessibility.md` says
 * what this gate does not cover and what to do about it.
 */

const THEMES = ["light", "dark"] as const;

test.describe("WCAG 2.2 AA", () => {
  test.describe("route coverage", () => {
    test("audits every route the application registers", () => {
      /*
       * The guard that makes the sweep exhaustive rather than merely long. A
       * route added to `ROUTES` and wired into the router is reachable, and a
       * reachable page nothing audits is the one that regresses. This turns
       * "we forgot to add it to the list" into a failing test in the same pull
       * request that adds the route.
       */
      const audited = new Set(AUDIT_TARGETS.map((target) => target.route));
      const missing = Object.values(ROUTES).filter((route) => !audited.has(route));

      expect(missing, "routes with no entry in AUDIT_TARGETS").toEqual([]);
    });

    test("names each audited route once", () => {
      const routes = AUDIT_TARGETS.map((target) => target.route);
      expect(routes).toHaveLength(new Set(routes).size);
    });
  });

  for (const colorScheme of THEMES) {
    test.describe(`${colorScheme} theme`, () => {
      /*
       * The OS preference rather than the in-app toggle, because the app's
       * default mode is `system` and this is the setting a first visit
       * actually resolves against. It also keeps the audit independent of
       * `ThemeContext`'s storage: a bug in the toggle cannot silently audit
       * light mode twice.
       */
      test.use({ colorScheme });

      for (const target of AUDIT_TARGETS) {
        test(target.name, async ({ page }) => {
          if (target.authenticated) await seedSession(page);

          await page.goto(target.url ?? target.route);
          await expect(page.locator(target.ready).first()).toBeVisible();

          await expectNoViolations(page, `${target.name} (${colorScheme})`);
        });
      }

      for (const target of UNREGISTERED_TARGETS) {
        test(target.name, async ({ page }) => {
          await page.goto(target.url);
          await expect(page.locator(target.ready).first()).toBeVisible();

          await expectNoViolations(page, `${target.name} (${colorScheme})`);
        });
      }
    });
  }

  /*
   * A page sweep only ever sees a component's resting state, and the states
   * that go wrong are the other ones: a dialog that leaves the page behind it
   * in the accessibility tree, a listbox whose options lose their owner when
   * it opens, a status message that arrives in no live region. Each of these
   * opens something and audits what the sweep cannot reach.
   *
   * They run in light mode only. The interactive state is a question about
   * markup — roles, names, ownership — and markup does not vary by theme; the
   * one thing that does, contrast, is already audited twice per route above.
   */
  test.describe("interactive states", () => {
    test("the select menu with its popover open", async ({ page }) => {
      await page.goto(ROUTES.HEADLESS_LAB);

      // The popover is the part of this page the sweep never sees: closed, its
      // options are not in the DOM at all, so the roles, the `aria-activedescendant`
      // wiring and the check glyph's contrast are all unaudited until it opens.
      await page.getByRole("button", { name: /Framework/ }).click();
      await expect(page.getByRole("listbox", { name: "Framework", exact: true })).toBeVisible();

      await expectNoViolations(page, "headless lab with the select menu open");
    });

    test("the checkout form at the payment step", async ({ page }) => {
      await page.goto(`${ROUTES.CHECKOUT_LAB}?latency=0`);

      await page.getByRole("button", { name: /continue to delivery/i }).click();
      await page.getByLabel(/Full name/).fill("Grace Hopper");
      await page.getByLabel(/Address/).fill("12 Navy Yard");
      await page.getByLabel(/Town or city/).fill("Arlington");
      await page.getByLabel(/Postcode/).fill("SW1A 1AA");
      await page.getByRole("button", { name: /continue to payment/i }).click();

      // Two states in one: a stepper with a *completed* step behind the active
      // one, and a second form. Arriving at the lab shows neither.
      await expect(page.getByLabel(/Card number/)).toBeVisible();

      await expectNoViolations(page, "checkout lab at the payment step");
    });
  });
});
