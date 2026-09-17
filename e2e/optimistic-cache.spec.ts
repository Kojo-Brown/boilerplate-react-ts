/**
 * The claims about optimistic cache updates that jsdom cannot make.
 *
 * The unit suite drives a real `QueryClient` and asserts on its contents, which
 * is the right tool for the engine's ordering rules. Two things it cannot
 * answer:
 *
 * 1. **Whether a user sees the change before the request finishes.** In a unit
 *    test every await is a microtask and "immediately" is not measurable. Here
 *    the fake server takes three seconds, and the assertions are given two, so
 *    a row that is on screen is provably on screen ahead of the server.
 * 2. **Whether independently mounted components agree.** Three panels each run
 *    their own `useQuery`. In jsdom they are three calls in one render pass; in
 *    a browser they are three subscriptions to one cache, and the mutation
 *    reaching all of them is the property under test.
 */

import { test, expect, type Page } from "@playwright/test";

const LAB = "/labs/query-cache";

const panel = (page: Page, filter: "all" | "open" | "done") =>
  page.getByTestId(`task-panel-${filter}`);

const rowIn = (page: Page, filter: "all" | "open" | "done", title: string) =>
  panel(page, filter).getByRole("listitem").filter({ hasText: title });

/**
 * The latency knob slows reads as well as writes, so the seed load costs a full
 * round trip before anything here can start. The generous timeout is that, not
 * flake cover: every assertion inside a test is tight.
 */
async function openLab(page: Page, search: string): Promise<void> {
  await page.goto(`${LAB}${search}`);
  await expect(panel(page, "all").getByTestId("cached-task-row")).toHaveCount(3, {
    timeout: 20_000,
  });
}

test.describe("query cache lab — optimistic writes", () => {
  test("a new row reaches every list that admits it, before the server answers", async ({
    page,
  }) => {
    // Three seconds of latency: anything on screen within two got there without
    // the server.
    await openLab(page, "?latency=3000");

    await page.getByTestId("cached-task-input").fill("Drawn before the request");
    await page.getByTestId("cached-add-task").click();

    // Two independently mounted panels, one mutate().
    await expect(rowIn(page, "all", "Drawn before the request")).toBeVisible({ timeout: 2_000 });
    await expect(rowIn(page, "open", "Drawn before the request")).toBeVisible({ timeout: 2_000 });
    // And not the one whose filter rejects it.
    await expect(rowIn(page, "done", "Drawn before the request")).toHaveCount(0);

    // Still provisional, and saying so.
    await expect(rowIn(page, "open", "Drawn before the request")).toHaveAttribute(
      "data-draft",
      "true",
    );
    await expect(page.getByTestId("cached-task-board")).toHaveAttribute("aria-busy", "true");
  });

  test("the counts wait for the server while the rows do not", async ({ page }) => {
    await openLab(page, "?latency=3000");
    await expect(page.getByTestId("task-stat-total")).toHaveText("3");

    await page.getByTestId("cached-task-input").fill("Not counted yet");
    await page.getByTestId("cached-add-task").click();

    await expect(rowIn(page, "all", "Not counted yet")).toBeVisible({ timeout: 2_000 });
    // Invalidated, not patched: this client cannot compute a server-side total.
    await expect(page.getByTestId("task-stat-total")).toHaveText("3");

    // And it does catch up, once the invalidation has refetched.
    await expect(page.getByTestId("task-stat-total")).toHaveText("4", { timeout: 30_000 });
    await expect(rowIn(page, "all", "Not counted yet")).not.toHaveAttribute("data-draft", "true");
  });

  test("a rejected toggle moves the row and puts it back", async ({ page }) => {
    await openLab(page, "?fail=setDone&latency=3000");
    const title = "Break a verb and watch the rollback";

    await panel(page, "open").getByRole("checkbox", { name: title }).click();

    // Gone from "open" and arrived in "done" straight away.
    await expect(rowIn(page, "open", title)).toHaveCount(0, { timeout: 2_000 });
    await expect(rowIn(page, "done", title)).toBeVisible();

    // Then the server refuses, and it goes back where it came from.
    await expect(page.getByTestId("cached-task-error")).toBeVisible({ timeout: 15_000 });
    await expect(rowIn(page, "open", title)).toBeVisible();
    await expect(rowIn(page, "done", title)).toHaveCount(0);
  });

  test("rolling one change back leaves an overlapping one alone", async ({ page }) => {
    // The case snapshot-and-restore gets wrong: the delete's snapshot predates
    // the add, so restoring it would take the added row with it.
    await openLab(page, "?fail=remove&latency=3000");
    const doomed = "Turn the latency up and overlap two changes";

    await panel(page, "open")
      .getByRole("button", { name: `Delete ${doomed}` })
      .click();
    await expect(rowIn(page, "open", doomed)).toHaveCount(0, { timeout: 2_000 });

    // Started while the delete is still in flight.
    await page.getByTestId("cached-task-input").fill("Survivor");
    await page.getByTestId("cached-add-task").click();
    await expect(rowIn(page, "open", "Survivor")).toBeVisible({ timeout: 2_000 });

    await expect(page.getByTestId("cached-task-error")).toBeVisible({ timeout: 15_000 });

    // The delete rolled back and the add did not.
    await expect(rowIn(page, "open", doomed)).toBeVisible();
    await expect(rowIn(page, "open", "Survivor")).toBeVisible();
  });
});
