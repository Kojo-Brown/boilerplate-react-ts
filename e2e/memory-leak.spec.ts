/**
 * The memory-leak gate: does repeating a journey leave anything behind?
 *
 * Everything in `tooling/memoryAudit/` is unit-tested against fixtures, which
 * checks the arithmetic and nothing else. The questions that need a real
 * browser are the ones this file asks:
 *
 * - does Chrome's heap snapshot actually contain what the reader expects it to
 *   (the `detachedness` column, the `Detached ` names, `to_node` as a flat
 *   offset), or was the format taken on faith from documentation;
 * - does the listener probe survive a real page's registrations, including the
 *   ones React and the router make before any test code runs;
 * - and, the only question a user cares about, does this application leak.
 *
 * ## The method, in three steps
 *
 * 1. **Warm up.** Run the journey once and throw the measurement away. The
 *    route chunk, the query cache, the font, the compiled regexes — all of it
 *    is allocated on the first pass and none of it is a leak.
 * 2. **Measure twice, with *N* repetitions in between.** Force a collection
 *    before each snapshot, so what is counted is what survived it.
 * 3. **Judge the growth, per iteration.** See `leakVerdict.ts` for why the
 *    absolute count is the wrong thing to assert on.
 *
 * ## Why there is a deliberately leaky test
 *
 * A green memory gate is indistinguishable from a memory gate that measures
 * nothing — both print "no leak". `catches a page that really is leaking`
 * plants a leak of a known size and asserts the audit sees it, in the detached
 * count, in the listener census and in the retainer path. That is the only
 * evidence the two passing tests above it mean anything. It was written first,
 * and their thresholds were only trusted once it had failed for the right
 * reason.
 *
 * The two real journeys cover the two shapes a leak takes in a single-page
 * application: something that mounts and unmounts with a *route*, and
 * something that appears and disappears *within* one — a popup binding
 * listeners to the document for as long as it is open.
 */

import { test, expect, type CDPSession, type Page } from "@playwright/test";
import { captureHeapSnapshot, collectGarbage } from "../tooling/memoryAudit/captureSnapshot.ts";
import {
  parseHeapSnapshot,
  findDetachedNodes,
  summarizeDetached,
  shortestRetainerPath,
  type DetachedNode,
  type DetachedSummary,
} from "../tooling/memoryAudit/heapSnapshot.ts";
import {
  installListenerProbe,
  readListenerProbeCensus,
  diffListenerCensus,
  type ListenerCensus,
} from "../tooling/memoryAudit/listenerProbe.ts";
import { evaluateLeakSample, type LeakSample } from "../tooling/memoryAudit/leakVerdict.ts";
import {
  formatVerdict,
  formatDetachedSummary,
  formatListenerDeltas,
  formatRetainerPath,
} from "../tooling/memoryAudit/report.ts";

/**
 * Repetitions between the two samples.
 *
 * Enough that a one-node-per-iteration leak clears the noise floor, few enough
 * that the whole test — two heap snapshots included — stays inside a minute on
 * a CI runner. A leak smaller than one node per iteration is not something
 * this method can see, and inflating the count to chase it buys flakiness.
 */
const ITERATIONS = 10;

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "Heap snapshots come from CDP, which is Chromium-only.",
);

interface Measurement {
  readonly sample: LeakSample;
  readonly summary: DetachedSummary;
  readonly census: ListenerCensus;
  readonly snapshot: string;
  readonly detached: readonly DetachedNode[];
}

/**
 * One measurement: collect, snapshot, count.
 *
 * The raw snapshot text is carried out with the numbers rather than parsed and
 * discarded, so a failure can go back to it for retainer paths without taking
 * a second snapshot of a page that has moved on since.
 */
async function measure(page: Page, cdp: CDPSession): Promise<Measurement> {
  await collectGarbage(cdp);
  const snapshot = await captureHeapSnapshot(cdp);
  const graph = parseHeapSnapshot(snapshot);
  const detached = findDetachedNodes(graph);
  const summary = summarizeDetached(detached);
  const census = await page.evaluate(readListenerProbeCensus);

  return {
    snapshot,
    detached,
    summary,
    census,
    sample: {
      detachedNodes: summary.count,
      detachedBytes: summary.selfSize,
      liveListeners: census.total,
      detachedListeners: census.detachedTotal,
    },
  };
}

/**
 * Publishes the numbers whether or not the gate failed.
 *
 * A memory gate that only speaks up when it fails gives a reviewer nothing to
 * compare against on the day it does. Attached to the Playwright report, which
 * CI already uploads, so "how many detached nodes did `main` have last week"
 * is answerable without re-running anything.
 */
async function attachReport(name: string, body: string): Promise<void> {
  await test.info().attach(name, { body, contentType: "text/plain" });
}

/** The whole diagnosis, assembled only when the gate is about to fail. */
function diagnose(baseline: Measurement, after: Measurement, verdict: string): string {
  const worst = after.summary.bySpecies[0]?.species;
  const example = after.detached.find((node) => node.species === worst);
  const path =
    example === undefined
      ? "  (nothing detached to trace)"
      : formatRetainerPath(
          shortestRetainerPath(parseHeapSnapshot(after.snapshot), example.ordinal),
        );

  return [
    verdict,
    "",
    formatDetachedSummary(after.summary),
    "",
    formatListenerDeltas(diffListenerCensus(baseline.census, after.census)),
    "",
    `Shortest retaining path to one ${worst ?? "detached node"}:`,
    path,
  ].join("\n");
}

/**
 * One pass of the journey a user actually makes: out to a route and back.
 *
 * Both steps are *client-side* navigations through the app's own link
 * components, which is the case that leaks — every page component, every hook
 * in it and every observer it registered is mounted and then unmounted, while
 * the document, the router, the store and the query client all survive. A
 * `page.goto` per step would tear the document down each time and measure
 * nothing but Chrome's ability to free a whole page.
 *
 * The journey ends where it started, which is what makes "the count should not
 * have moved" a legitimate expectation rather than an approximation.
 */
async function journey(page: Page): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Main navigation" });

  await nav.getByRole("link", { name: "About" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "About" })).toBeVisible();

  await nav.getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "React TS Boilerplate" })).toBeVisible();
}

test.describe("memory audit", () => {
  test("repeated navigation leaves no detached nodes or listeners behind", async ({
    page,
    context,
  }) => {
    // Two heap snapshots of a real page, plus 11 journeys.
    test.slow();

    await page.addInitScript(installListenerProbe);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "React TS Boilerplate" }),
    ).toBeVisible();

    const cdp = await context.newCDPSession(page);

    await journey(page);
    const baseline = await measure(page, cdp);

    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      await journey(page);
    }
    const after = await measure(page, cdp);

    const verdict = evaluateLeakSample({
      baseline: baseline.sample,
      after: after.sample,
      policy: {
        iterations: ITERATIONS,
        // One node per iteration is under the run-to-run noise of a real
        // page; anything genuinely retained by a mount accumulates faster
        // than this within a handful of iterations.
        maxDetachedNodesPerIteration: 1,
        // Listeners are exact — the probe counts registrations, not bytes —
        // so a journey that ends where it started must end with the listener
        // count it started with. Zero is the only defensible ceiling.
        maxListenersPerIteration: 0,
        maxDetachedListeners: 0,
      },
    });

    const report = diagnose(baseline, after, formatVerdict(verdict));
    await attachReport("navigation-journey", report);
    expect(verdict.failed, report).toBe(false);
  });

  test("opening and closing a popup leaves nothing bound to the document", async ({
    page,
    context,
  }) => {
    test.slow();

    // The other half of the hunt. Navigation exercises components that mount
    // and unmount together with a route; this exercises the pattern that
    // leaks without any route changing — a subtree that appears and
    // disappears while registering listeners on something that outlives it.
    // `SelectMenu` binds `pointerdown` on `document` for exactly as long as
    // its popup is open, which is the shape a missing cleanup would show up
    // in as one more document listener per open.
    await page.addInitScript(installListenerProbe);
    await page.goto("/labs/headless");
    await expect(page.getByRole("heading", { level: 1, name: "Headless Lab" })).toBeVisible();

    const trigger = page.locator('button[aria-haspopup="listbox"]');
    const cycle = async (): Promise<void> => {
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
    };

    const cdp = await context.newCDPSession(page);

    await cycle();
    const baseline = await measure(page, cdp);

    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      await cycle();
    }
    const after = await measure(page, cdp);

    const verdict = evaluateLeakSample({
      baseline: baseline.sample,
      after: after.sample,
      policy: {
        iterations: ITERATIONS,
        maxDetachedNodesPerIteration: 1,
        maxListenersPerIteration: 0,
        maxDetachedListeners: 0,
      },
    });

    const report = diagnose(baseline, after, formatVerdict(verdict));
    await attachReport("popup-cycle", report);
    expect(verdict.failed, report).toBe(false);
  });

  test("catches a page that really is leaking", async ({ page, context }) => {
    test.slow();

    await page.addInitScript(installListenerProbe);
    await page.goto("/");

    // A leak of a shape this audit has to catch, and the shape most React
    // leaks take: a subtree removed from the document while something
    // long-lived still points at it — here a module-level array, in real code
    // a closure held by a listener, a timer or a cache.
    await page.evaluate(() => {
      const retained: HTMLElement[] = [];
      Reflect.set(window, "__leakStore__", retained);
      Reflect.set(window, "__leakOnce__", () => {
        const host = document.createElement("div");
        host.className = "leak-host";
        for (let index = 0; index < 20; index += 1) {
          const child = document.createElement("span");
          child.textContent = `leaked ${String(index)}`;
          child.addEventListener("click", () => retained.length);
          host.append(child);
        }
        document.body.append(host);
        host.remove();
        retained.push(host);
      });
    });

    const leakOnce = async (): Promise<void> => {
      await page.evaluate(() => {
        (Reflect.get(window, "__leakOnce__") as () => void)();
      });
    };

    const cdp = await context.newCDPSession(page);

    await leakOnce();
    const baseline = await measure(page, cdp);

    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      await leakOnce();
    }
    const after = await measure(page, cdp);

    const verdict = evaluateLeakSample({
      baseline: baseline.sample,
      after: after.sample,
      policy: {
        iterations: ITERATIONS,
        maxDetachedNodesPerIteration: 1,
        maxListenersPerIteration: 0,
        maxDetachedListeners: 0,
      },
    });

    // Each iteration strands one `div` plus 20 `span`s plus their text nodes,
    // so the detached count has to move by far more than the ceiling. Checking
    // the specific finding rather than only `failed` is what stops this test
    // from passing because some *other* metric happened to trip.
    const detachedFinding = verdict.findings.find((f) => f.metric === "detachedNodes");
    expect(detachedFinding?.status).toBe("over");
    expect(detachedFinding?.growth).toBeGreaterThan(ITERATIONS * 20);

    // The listener half has to see it too: 20 click handlers per iteration,
    // every one of them on a node that is no longer in the document.
    const listenerFinding = verdict.findings.find((f) => f.metric === "detachedListeners");
    expect(listenerFinding?.status).toBe("over");
    expect(after.sample.detachedListeners).toBeGreaterThanOrEqual(ITERATIONS * 20);

    // And the diagnosis has to name the culprit. A gate that says "you have
    // 231 detached nodes" and cannot say who is holding them sends the reader
    // to DevTools to start over.
    const graph = parseHeapSnapshot(after.snapshot);
    const example = after.detached.find((node) => node.species === "<span>");
    expect(example, "expected the leaked spans in the snapshot").toBeDefined();
    const path = shortestRetainerPath(graph, example?.ordinal ?? 0);
    expect(path, "expected a retaining path from a GC root to a leaked span").not.toBeNull();

    // The path has to start at the root and pass through the property that is
    // actually doing the retaining. `__leakStore__` is the line of code a
    // reader would go and delete; anything less specific — "it is reachable
    // from Window" — is true of every object on the page.
    expect(path?.[0]?.type, formatRetainerPath(path)).toBe("synthetic");
    expect(
      path?.some((step) => step.via === "property __leakStore__"),
      formatRetainerPath(path),
    ).toBe(true);
  });
});
