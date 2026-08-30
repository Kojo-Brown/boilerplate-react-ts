/**
 * The half of the Comlink worker pattern that jsdom cannot supply.
 *
 * `src/shared/lib/csvParserApi.test.ts` drives the real Comlink protocol over a
 * `MessageChannel`, which reproduces the serialisation, the proxies and the
 * task queue. What it cannot reproduce is a second thread — and "the main
 * thread stays responsive" is the entire claim being made. Everything here
 * needs a real browser:
 *
 * - a `Worker` is actually constructed, from a URL the bundler resolved;
 * - a click is handled while a 200,000-row parse is in flight;
 * - the blocking arm produces a frame longer than anything the worker arm does;
 * - an `AbortSignal` genuinely cannot cross a `postMessage` boundary, which is
 *   the constraint the job-id/`cancel` protocol exists to work around. jsdom
 *   does *not* reproduce this: under Node's `structuredClone` a jsdom
 *   `AbortSignal` clones happily into a plain object, so a unit test asserting
 *   the throw would assert the opposite of the truth.
 */

import { test, expect, type Page, type TestInfo } from "@playwright/test";

const LARGE_ROWS = 200_000;
const SMALL_ROWS = 10_000;
/** Building and parsing 200k rows is slow, and slower on a CI runner. */
const RUN_TIMEOUT_MS = 120_000;

interface FrameStats {
  frames: number;
  longestFrameMs: number;
  p95FrameMs: number;
  droppedFrames: number;
  fps: number;
}

async function openLab(page: Page, query: string): Promise<void> {
  await page.goto(`/labs/workers${query}`);
  await expect(page.getByRole("heading", { name: "Web Worker Lab" })).toBeVisible();
}

async function buildSample(page: Page, rows: number): Promise<void> {
  await page.getByTestId("build-sample").click();
  await expect(page.getByTestId("sample-summary")).toContainText(rows.toLocaleString("en-US"));
}

async function readFrameStats(page: Page): Promise<FrameStats> {
  const raw = await page.getByTestId("frame-stats").getAttribute("data-stats");
  expect(raw).not.toBeNull();
  return JSON.parse(raw ?? "{}") as FrameStats;
}

async function readRowCount(page: Page): Promise<string> {
  const summary = await page.getByTestId("result-summary").textContent();
  return (summary ?? "").split(" ")[0] ?? "";
}

test.describe("worker parsing", () => {
  test("starts a real Worker, and only when a parse is asked for", async ({ page }) => {
    await openLab(page, `?rows=${String(SMALL_ROWS)}`);
    await buildSample(page, SMALL_ROWS);

    // Nothing yet: the client builds its worker on the first parse, so a route
    // the user only looks at costs no thread.
    expect(page.workers()).toHaveLength(0);

    const started = page.waitForEvent("worker");
    await page.getByTestId("run-parse").click();
    const worker = await started;

    // The URL resolving at all is the assertion: `new Worker(new URL(…,
    // import.meta.url))` has to be written literally for the bundler to see it,
    // and a rewritten one 404s here rather than failing to compile.
    expect(worker.url()).toContain("csvParser.worker");
    await expect(page.getByTestId("parse-status")).toHaveAttribute("data-status", "complete");
  });

  test("handles a click while a 200,000-row parse is in flight", async ({ page }) => {
    test.setTimeout(RUN_TIMEOUT_MS);
    await openLab(page, `?rows=${String(LARGE_ROWS)}`);
    await buildSample(page, LARGE_ROWS);

    await page.getByTestId("run-parse").click();
    await expect(page.getByTestId("parse-status")).toHaveAttribute("data-status", "parsing");

    // The whole claim, as one interaction: the button is enabled, the click is
    // dispatched, and the cancel message reaches a loop that is mid-parse.
    await page.getByTestId("cancel-parse").click();
    await expect(page.getByTestId("parse-status")).toHaveAttribute("data-status", "cancelled");
    await expect(page.getByTestId("parse-status")).toContainText(/Cancelled after [\d,]+ rows/);

    const cancelled = await page.getByTestId("parse-status").textContent();
    const rows = Number((cancelled ?? "").replace(/\D/g, ""));
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThan(LARGE_ROWS);
  });

  test("both arms agree on the totals", async ({ page }) => {
    test.setTimeout(RUN_TIMEOUT_MS);

    await openLab(page, `?rows=${String(SMALL_ROWS)}&mode=worker`);
    await buildSample(page, SMALL_ROWS);
    await page.getByTestId("run-parse").click();
    await expect(page.getByTestId("parse-status")).toHaveAttribute("data-status", "complete");
    const workerSummary = await page.getByTestId("result-summary").textContent();

    await openLab(page, `?rows=${String(SMALL_ROWS)}&mode=main`);
    await buildSample(page, SMALL_ROWS);
    await page.getByTestId("run-parse").click();
    await expect(page.getByTestId("parse-status")).toHaveAttribute("data-status", "complete");
    const mainSummary = await page.getByTestId("result-summary").textContent();

    // Same parser, same bytes, same seed — the elapsed time differs, so the
    // comparison is on the row count and the net total that precede it.
    const withoutTiming = (text: string | null): string =>
      (text ?? "").replace(/·\s*\d+\s*ms/, "").trim();
    expect(withoutTiming(workerSummary)).toBe(withoutTiming(mainSummary));
    expect(await readRowCount(page)).not.toBe("");
  });

  test("the blocking arm loses frames the worker arm keeps", async ({ page }, testInfo) => {
    test.setTimeout(RUN_TIMEOUT_MS);

    const run = async (mode: "worker" | "main"): Promise<FrameStats> => {
      await openLab(page, `?rows=${String(LARGE_ROWS)}&mode=${mode}`);
      await buildSample(page, LARGE_ROWS);
      await page.getByTestId("run-parse").click();
      await expect(page.getByTestId("parse-status")).toHaveAttribute("data-status", "complete", {
        timeout: RUN_TIMEOUT_MS,
      });
      await expect(page.getByTestId("frame-stats")).toBeVisible();
      return readFrameStats(page);
    };

    const worker = await run("worker");
    const main = await run("main");

    await attach(testInfo, { worker, main });

    /*
     * The blocking arm cannot produce a frame shorter than its parse, because
     * `requestAnimationFrame` does not fire while the thread is inside the
     * loop; the worker arm's worst frame is bounded by a chunk instead. The
     * floor is stated as five frame budgets rather than as a millisecond count
     * matched to one machine — 200k rows parse in ~150ms here and will take
     * longer on a CI runner, so a tighter number would be measuring the box.
     */
    expect(main.longestFrameMs).toBeGreaterThan(5 * (1000 / 60));
    expect(worker.longestFrameMs).toBeLessThan(main.longestFrameMs / 2);
    // Both recordings have to contain frames at all, or the comparison above is
    // between two empty measurements that happen to satisfy it.
    expect(worker.frames).toBeGreaterThan(0);
    expect(main.frames).toBeGreaterThan(0);
  });

  test("an AbortSignal cannot cross a postMessage boundary", async ({ page }) => {
    await openLab(page, "");

    const outcome = await page.evaluate(() => {
      try {
        structuredClone(new AbortController().signal);
        return { threw: false, name: "" };
      } catch (error) {
        return { threw: true, name: error instanceof Error ? error.name : String(error) };
      }
    });

    // This is why cancellation is a job id plus a separate `cancel` call rather
    // than a signal passed as an argument.
    expect(outcome.threw).toBe(true);
    expect(outcome.name).toBe("DataCloneError");
  });
});

async function attach(
  testInfo: TestInfo,
  results: { worker: FrameStats; main: FrameStats },
): Promise<void> {
  await testInfo.attach("worker-vs-main-thread-frames.json", {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });
}
