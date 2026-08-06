/**
 * Before/after jank benchmark for the React 19 concurrency pattern.
 *
 * Both arms render the same 15,000-row list and do the same filtering work.
 * The only difference is scheduling: the "blocking" arm renders the list from
 * the urgent state, so every keystroke waits for a full re-render; the
 * "concurrent" arm renders it from `useDeferredValue`, so React commits the
 * keystroke first and renders the list at a lower, interruptible priority.
 *
 * The numbers are attached to the Playwright report on every run — this is a
 * measurement, not just an assertion.
 */

import { test, expect, type Page, type TestInfo } from "@playwright/test";

const ITEM_COUNT = 15_000;
const QUERY = "deferred";
/** Roughly a fast typist; slow enough that each keystroke gets its own frame. */
const KEYSTROKE_DELAY_MS = 60;
/** Rendering the initial list is slow by design, and slower still on CI. */
const FIRST_PAINT_TIMEOUT_MS = 60_000;
/** The deferred render has to finish before the recording is closed. */
const SETTLE_TIMEOUT_MS = 30_000;

type Mode = "concurrent" | "blocking";

interface FrameStats {
  frames: number;
  durationMs: number;
  longestFrameMs: number;
  meanFrameMs: number;
  p95FrameMs: number;
  droppedFrames: number;
  droppedFrameRatio: number;
  fps: number;
}

interface InteractionStats {
  /** Interactions the Event Timing API reported as slower than a frame. */
  slowInteractions: number;
  /** Worst keypress-to-paint latency observed, in ms (0 if none were slow). */
  maxInteractionMs: number;
  /** Sum of the reported slow interactions, in ms. */
  totalInteractionMs: number;
}

interface ArmResult extends FrameStats, InteractionStats {
  mode: Mode;
  /** Whether the list was ever observably behind the input. */
  sawStaleList: boolean;
  /** Matches left after filtering — proves both arms did the same work. */
  matchCount: number;
}

interface PageProbe {
  sawStale: boolean;
  interactions: number[];
}

/**
 * `durationThreshold` is part of the Event Timing spec but is not yet in
 * TypeScript's `PerformanceObserverInit`.
 */
interface EventTimingObserverInit extends PerformanceObserverInit {
  durationThreshold?: number;
}

/**
 * Installs the two in-page probes:
 *
 * - a MutationObserver on `data-stale`, because a commit where the list lags
 *   the input is the observable signature of `useDeferredValue` and polling
 *   from the runner would miss it;
 * - a PerformanceObserver on `event` entries, which is the browser's own
 *   measure of keypress-to-next-paint latency (the input half of INP). The
 *   spec's minimum `durationThreshold` is 16ms, so every entry it reports is
 *   by definition an interaction that missed a frame.
 */
async function installProbes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const list = document.querySelector('[data-testid="filter-results"]');
    if (!list) throw new Error("results list not found");

    const probe: PageProbe = {
      sawStale: list.getAttribute("data-stale") === "true",
      interactions: [],
    };
    Object.defineProperty(window, "__probe", { value: probe, configurable: true });

    new MutationObserver(() => {
      if (list.getAttribute("data-stale") === "true") probe.sawStale = true;
    }).observe(list, { attributes: true, attributeFilter: ["data-stale"] });

    const eventTimingOptions: EventTimingObserverInit = { type: "event", durationThreshold: 16 };
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        if (entry.name === "keydown" || entry.name === "input") {
          probe.interactions.push(entry.duration);
        }
      }
    }).observe(eventTimingOptions);
  });
}

async function readProbes(page: Page): Promise<PageProbe> {
  return page.evaluate(() => {
    const probe = (window as unknown as { __probe?: PageProbe }).__probe;
    return probe ?? { sawStale: false, interactions: [] };
  });
}

async function measure(page: Page, mode: Mode): Promise<ArmResult> {
  await page.goto(`/labs/concurrency?mode=${mode}&n=${String(ITEM_COUNT)}`);

  const list = page.getByTestId("concurrent-filter-list");
  // The first paint of 15,000 un-virtualised rows costs seconds on its own —
  // that is the premise of the demo, not a hang, so it gets a long timeout.
  // It is also not part of the measurement: recording starts after it lands.
  await expect(list).toHaveAttribute("data-mode", mode, { timeout: FIRST_PAINT_TIMEOUT_MS });
  await expect(page.getByTestId("result-count")).toHaveText(
    `${ITEM_COUNT.toString()} of ${ITEM_COUNT.toString()} matches`,
    { timeout: FIRST_PAINT_TIMEOUT_MS },
  );

  await installProbes(page);

  await page.getByTestId("record-toggle").click();
  await expect(page.getByTestId("recording-state")).toHaveText("Recording…");

  const input = page.getByTestId("filter-input");
  await input.click();
  await input.pressSequentially(QUERY, { delay: KEYSTROKE_DELAY_MS });

  // Let the deferred render land before the recording is closed, so the
  // concurrent arm is charged for the same work the blocking arm did.
  await expect(page.getByTestId("filter-results")).toHaveAttribute("data-stale", "false", {
    timeout: SETTLE_TIMEOUT_MS,
  });
  await expect(page.getByTestId("busy-label")).toBeEmpty({ timeout: SETTLE_TIMEOUT_MS });

  await page.getByTestId("record-toggle").click();
  await expect(page.getByTestId("recording-state")).toHaveText("Idle");

  const raw = await page.getByTestId("frame-stats").getAttribute("data-stats");
  expect(raw, "frame stats should be recorded").not.toBeNull();
  const stats = JSON.parse(raw ?? "{}") as FrameStats;

  const countText = (await page.getByTestId("result-count").textContent()) ?? "";
  const matchCount = Number(countText.split(" ")[0]);

  const probe = await readProbes(page);

  return {
    ...stats,
    mode,
    matchCount,
    sawStaleList: probe.sawStale,
    slowInteractions: probe.interactions.length,
    maxInteractionMs: probe.interactions.reduce((max, ms) => Math.max(max, ms), 0),
    totalInteractionMs: probe.interactions.reduce((sum, ms) => sum + ms, 0),
  };
}

function formatReport(concurrent: ArmResult, blocking: ArmResult): string {
  const row = (label: string, pick: (arm: ArmResult) => string): string =>
    `| ${label} | ${pick(blocking)} | ${pick(concurrent)} |`;

  return [
    `# Jank benchmark — ${ITEM_COUNT.toLocaleString("en-US")} rows, typing "${QUERY}"`,
    "",
    "| Metric | Blocking (before) | Concurrent (after) |",
    "| --- | --- | --- |",
    row("Worst keypress → paint", (arm) => `${arm.maxInteractionMs.toFixed(1)} ms`),
    row("Keypresses that missed a frame", (arm) => arm.slowInteractions.toString()),
    row("Time spent blocked on input", (arm) => `${arm.totalInteractionMs.toFixed(1)} ms`),
    row("Longest frame", (arm) => `${arm.longestFrameMs.toFixed(1)} ms`),
    row("p95 frame", (arm) => `${arm.p95FrameMs.toFixed(1)} ms`),
    row("Dropped frames", (arm) => `${arm.droppedFrames.toString()} / ${arm.frames.toString()}`),
    row("Effective FPS", (arm) => arm.fps.toFixed(1)),
    row("List ever lagged the input", (arm) => (arm.sawStaleList ? "yes" : "no")),
    "",
  ].join("\n");
}

async function attachReport(
  testInfo: TestInfo,
  concurrent: ArmResult,
  blocking: ArmResult,
): Promise<void> {
  await testInfo.attach("jank-benchmark.md", {
    body: formatReport(concurrent, blocking),
    contentType: "text/markdown",
  });
  await testInfo.attach("jank-benchmark.json", {
    body: JSON.stringify({ blocking, concurrent }, null, 2),
    contentType: "application/json",
  });
}

test.describe("Concurrency lab — jank benchmark", () => {
  // Two full arms, each rendering 15,000 rows several times over. The default
  // 30s per-test budget is for interaction tests, not for one that deliberately
  // renders more DOM than a frame can hold.
  test.setTimeout(180_000);

  test("deferring the list keeps the main thread responsive while typing", async ({
    page,
  }, testInfo) => {
    const blocking = await measure(page, "blocking");
    const concurrent = await measure(page, "concurrent");

    await attachReport(testInfo, concurrent, blocking);
    // Logged as well as attached: the numbers are the point of this test, and
    // CI output is where anyone will actually look at them.
    console.log(formatReport(concurrent, blocking));

    // Both arms filtered the same dataset to the same result, so the frame
    // numbers below are comparing scheduling and nothing else.
    expect(concurrent.matchCount).toBe(blocking.matchCount);
    expect(concurrent.matchCount).toBeGreaterThan(0);
    expect(concurrent.frames).toBeGreaterThan(0);
    expect(blocking.frames).toBeGreaterThan(0);

    // The behavioural difference, independent of machine speed: only the
    // concurrent arm ever shows a list that lags the input.
    expect(concurrent.sawStaleList).toBe(true);
    expect(blocking.sawStaleList).toBe(false);

    // The cost of that difference, measured where the user feels it. Frame
    // stats alone would understate it: both arms still pay for one long,
    // uninterruptible commit when the list finally lands. What concurrency
    // buys is that the *keystroke* no longer waits for that commit.
    expect(blocking.slowInteractions).toBeGreaterThan(0);
    expect(blocking.maxInteractionMs).toBeGreaterThan(concurrent.maxInteractionMs * 2);
  });
});
