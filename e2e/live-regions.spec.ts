import { test, expect, type Page } from "@playwright/test";

/**
 * The live-region system in a real browser.
 *
 * Two things only this can prove.
 *
 * The first is what `src/app/main.tsx` owns and no unit test reaches: that the
 * four regions are in the document from the first paint, on every route
 * including the ones outside the app shell, and that they are *empty* when they
 * get there. A region that mounts with its text already in it is a new node
 * rather than a mutation, which is the one shape that reliably goes
 * unannounced — so "empty at first paint" is the precondition for every
 * announcement the app will ever make, and it is a property of where the
 * component is mounted rather than of the component.
 *
 * The second is the sequence. The transcript below is built by a
 * `MutationObserver` per region, which is the mechanism an assistive technology
 * actually watches a live region with: it records each region gaining text, so a
 * message written and overwritten inside one tick never appears in it — exactly
 * as it would never be spoken. Every claim about queueing, collapsing and
 * alternating halves is checked against that, and not against the state the page
 * happened to settle on.
 */

interface Transcript {
  readonly polite: readonly string[];
  readonly assertive: readonly string[];
}

const BRIDGE = "__liveRegionAnnounced";

/**
 * Starts recording announcements, and returns the transcript it fills.
 *
 * The observer runs in the page and reports each mutation over an exposed
 * function, so the array here grows as the browser speaks. It has to be
 * installed after a navigation, because the regions it observes belong to the
 * document.
 */
async function recordAnnouncements(page: Page, url: string): Promise<Transcript> {
  const polite: string[] = [];
  const assertive: string[] = [];

  await page.exposeFunction(BRIDGE, (politeness: string, text: string): void => {
    (politeness === "polite" ? polite : assertive).push(text);
  });
  await page.goto(url);
  await page.evaluate((bridge) => {
    const notify = (window as unknown as Record<string, (p: string, t: string) => void>)[bridge];
    if (notify === undefined) throw new Error(`${bridge} was not exposed`);

    for (const politeness of ["polite", "assertive"]) {
      /*
       * One observer per region rather than one over the pair. Watching the
       * pair's combined text would miss the case this file exists to check:
       * moving "No results" from one half to the other leaves the combined text
       * identical, which is the reading under which the bug looks like correct
       * behaviour.
       */
      for (const node of document.querySelectorAll(`[data-testid^="${politeness}-"]`)) {
        // `textContent` is non-nullable on an element; a region holds a text node
        // or nothing.
        let last = node.textContent;
        const observer = new MutationObserver(() => {
          const text = node.textContent;
          if (text === last) return;
          last = text;
          // A region going empty is the idle state, not something being said.
          if (text !== "") notify(politeness, text);
        });
        observer.observe(node, { childList: true, characterData: true, subtree: true });
      }
    }
  }, BRIDGE);

  return { polite, assertive };
}

const LAB = "/labs/live-regions";

test.describe("live regions", () => {
  test("are in the document, empty, and correctly labelled on first paint", async ({ page }) => {
    await page.goto("/");

    for (const testId of ["polite-0", "polite-1"]) {
      const region = page.getByTestId(testId);
      await expect(region).toHaveAttribute("aria-live", "polite");
      await expect(region).toHaveAttribute("aria-atomic", "true");
      await expect(region).toBeEmpty();
    }
    for (const testId of ["assertive-0", "assertive-1"]) {
      const region = page.getByTestId(testId);
      await expect(region).toHaveAttribute("aria-live", "assertive");
      await expect(region).toBeEmpty();
    }

    // And the page's own alerts are still the only things with that role: four
    // permanently mounted `role="alert"` spans would be found by every
    // `getByRole("alert")` in this directory.
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("exist on a route that renders outside the app shell", async ({ page }) => {
    // `/login` is not inside `RootLayout`. Regions mounted in the shell would not
    // exist here, which is the one flow where an unheard error message costs the
    // user the session.
    await page.goto("/login");

    await expect(page.getByTestId("live-regions")).toBeAttached();
    await expect(page.getByTestId("polite-0")).toBeEmpty();
  });

  test("keep polite and assertive messages apart", async ({ page }) => {
    const transcript = await recordAnnouncements(page, LAB);

    await page.getByTestId("announce-assertive").click();

    await expect.poll(() => transcript.assertive).toEqual(["Your session expires in one minute"]);
    expect(transcript.polite).toEqual([]);
  });

  test("announce the same message twice by alternating halves of the pair", async ({ page }) => {
    const transcript = await recordAnnouncements(page, LAB);

    await page.getByTestId("announce-repeat").click();
    await expect(page.getByTestId("polite-1")).toHaveText("No results");
    await expect(page.getByTestId("polite-0")).toBeEmpty();

    await page.getByTestId("announce-repeat").click();
    /*
     * Two mutations, and that is the assertion. One region would have produced
     * one: React declines to touch an unchanged text node, so the second press
     * would leave the DOM exactly as it was and nothing would be spoken.
     */
    await expect.poll(() => transcript.polite).toEqual(["No results", "No results"]);
    await expect(page.getByTestId("polite-0")).toHaveText("No results");
    await expect(page.getByTestId("polite-1")).toBeEmpty();
  });

  test("drain a burst one message at a time, collapsing the duplicate", async ({ page }) => {
    const transcript = await recordAnnouncements(page, LAB);

    await page.getByTestId("announce-burst").click();

    // Four announce() calls in one click, three mutations: the duplicate was
    // collapsed while it was still waiting, and no two of the rest were ever in
    // the document within one tick — which is the only way all three are heard.
    await expect
      .poll(() => transcript.polite)
      .toEqual(["Row 1 archived", "Row 2 archived", "Row 3 archived"]);
  });

  test("announce a toast, and keep the announcement after the card has gone", async ({ page }) => {
    const transcript = await recordAnnouncements(page, LAB);

    await page.getByTestId("toast-danger").click();
    await expect(page.getByTestId("toast")).toBeVisible();
    await expect
      .poll(() => transcript.assertive)
      .toEqual(["Upload failed. The file is larger than 10 MB"]);

    // The announcement outlives the card, which is the reason it is not made by
    // the card: four seconds is less than a screen reader often needs to reach a
    // message, and a live region removed from the document takes its text with it.
    await expect(page.getByTestId("toast")).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId("assertive-1")).toHaveText(
      "Upload failed. The file is larger than 10 MB",
    );
  });

  test("say only the result for a load that finishes quickly", async ({ page }) => {
    const transcript = await recordAnnouncements(page, LAB);
    await page.getByRole("radio", { name: /fast/ }).check();

    await page.getByTestId("run-query").click();
    await expect(page.getByTestId("query-status")).toHaveText("success");

    await expect.poll(() => transcript.polite).toEqual(["Report ready, 42 rows"]);
  });

  test("say the load and then the result when the load is slow", async ({ page }) => {
    const transcript = await recordAnnouncements(page, LAB);

    await page.getByTestId("run-query").click();
    await expect(page.getByTestId("query-status")).toHaveText("success");

    await expect
      .poll(() => transcript.polite)
      .toEqual(["Loading the report", "Report ready, 42 rows"]);
  });

  test("interrupt for a failed load", async ({ page }) => {
    const transcript = await recordAnnouncements(page, LAB);
    await page.getByTestId("should-fail").check();

    await page.getByTestId("run-query").click();
    await expect(page.getByTestId("query-status")).toHaveText("error");

    await expect.poll(() => transcript.assertive).toEqual(["The report could not be loaded"]);
    // The load itself outran the half-second grace period, so it was announced
    // politely before the failure interrupted.
    expect(transcript.polite).toEqual(["Loading the report"]);
  });

  test("announce a filter count once, after the typing stops", async ({ page }) => {
    const transcript = await recordAnnouncements(page, LAB);
    const input = page.getByTestId("filter-input");

    // Real keystrokes rather than `fill`: the point of the debounce is what
    // happens between them, and `fill` sets the value once.
    await input.click();
    await input.pressSequentially("blu", { delay: 40 });
    await expect(page.getByTestId("match-count")).toHaveText("1");

    await expect.poll(() => transcript.polite).toEqual(["1 match"]);
  });
});
