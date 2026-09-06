// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildGraph, type BundleGraph, type Manifest } from "./graph.ts";
import {
  evaluate,
  formatBudgetFile,
  measureGraph,
  parseBudgetFile,
  ratchet,
  REQUIRED_IDS,
  type BudgetFile,
  type Measurement,
} from "./evaluate.ts";

const manifest: Manifest = {
  "index.html": {
    file: "entry.js",
    name: "index",
    isEntry: true,
    imports: ["_router.js"],
    dynamicImports: ["src/pages/a.tsx", "src/pages/b.tsx"],
    css: ["entry.css"],
  },
  "_router.js": { file: "router.js", name: "router" },
  "_shared.js": { file: "shared.js", name: "shared" },
  "src/pages/a.tsx": {
    file: "a.js",
    name: "PageA",
    isDynamicEntry: true,
    imports: ["index.html", "_shared.js"],
  },
  "src/pages/b.tsx": { file: "b.js", name: "PageB", isDynamicEntry: true, imports: ["index.html"] },
};

/** One kilobyte per file unless named below, so every total is checkable by eye. */
const SIZES: Record<string, number> = {
  "entry.js": 10_000,
  "entry.css": 2_000,
  "router.js": 5_000,
  "shared.js": 3_000,
  "a.js": 4_000,
  "b.js": 9_000,
  "worker.js": 1_500,
};
const sizeOf = (file: string): number => SIZES[file] ?? 1_000;

const graph: BundleGraph = buildGraph(manifest);
const byId = (measurements: readonly Measurement[], id: string): Measurement | undefined =>
  measurements.find((m) => m.id === id);

describe("measureGraph", () => {
  const measurements = measureGraph(graph, ["worker.js"], sizeOf);

  it("sums the whole initial graph, not just the entry chunk", () => {
    expect(byId(measurements, "initial.js")?.bytes).toBe(15_000);
  });

  it("budgets the initial graph and its parts at the same time", () => {
    // The sum is what closes the loophole: a chunk over its ceiling can be
    // brought back under it by splitting it in two, and the sum does not move.
    expect(byId(measurements, "chunk.index")?.bytes).toBe(10_000);
    expect(byId(measurements, "chunk.router")?.bytes).toBe(5_000);
  });

  it("keeps stylesheets in their own budget", () => {
    // CSS and JS regress for unrelated reasons and are fixed by unrelated
    // people; one number for both hides whichever moved less.
    expect(byId(measurements, "initial.css")?.bytes).toBe(2_000);
  });

  it("names the most expensive route and charges it for what it pulls", () => {
    // PageA is a 4kB chunk that drags in 3kB of shared code, so it costs 7kB.
    // PageB is a 9kB chunk that drags in nothing. The chunk listing in Vite's
    // build output ranks these the other way round.
    const largest = byId(measurements, "lazy.largest");
    expect(largest?.bytes).toBe(9_000);
    expect(largest?.detail).toBe("PageB");
  });

  it("reports zero, not a crash, for a build with no lazy routes", () => {
    const flat = measureGraph(
      buildGraph({ "index.html": { file: "entry.js", isEntry: true } }),
      [],
      sizeOf,
    );
    expect(byId(flat, "lazy.largest")).toEqual({
      id: "lazy.largest",
      detail: "no lazy routes",
      bytes: 0,
    });
  });

  it("totals what the manifest could not see and names the files", () => {
    const unattributed = byId(measurements, "unattributed");
    expect(unattributed?.bytes).toBe(1_500);
    expect(unattributed?.detail).toContain("worker.js");
  });

  it("refuses two initial chunks that would share one budget id", () => {
    // Reachable in one line: `manualChunks: () => "vendor"`. Silently
    // budgeting whichever came second is worse than failing.
    const collided = buildGraph({
      "index.html": { file: "entry.js", name: "same", isEntry: true, imports: ["_other.js"] },
      "_other.js": { file: "other.js", name: "same" },
    });
    expect(() => measureGraph(collided, [], sizeOf)).toThrow(/both named "chunk.same"/);
  });
});

describe("evaluate", () => {
  const measurements = measureGraph(graph, ["worker.js"], sizeOf);
  const passing: BudgetFile = {
    compression: "gzip",
    budgets: {
      "initial.js": 16_000,
      "initial.css": 2_500,
      "lazy.largest": 10_000,
      unattributed: 2_000,
      "chunk.index": 11_000,
      "chunk.router": 6_000,
    },
  };

  it("passes a build under every ceiling", () => {
    const verdict = evaluate(measurements, passing);
    expect(verdict.failed).toBe(false);
    expect(verdict.findings.every((f) => f.status === "ok")).toBe(true);
  });

  it("fails the exact id that went over, and reports the others as fine", () => {
    const verdict = evaluate(measurements, {
      ...passing,
      budgets: { ...passing.budgets, "initial.js": 14_999 },
    });
    expect(verdict.failed).toBe(true);
    expect(verdict.findings.filter((f) => f.status === "over").map((f) => f.id)).toEqual([
      "initial.js",
    ]);
  });

  it("passes a measurement that exactly equals its ceiling", () => {
    // A budget is a ceiling, not a strict bound. Getting this backwards makes
    // `--update` write a file that fails on the very next run.
    const verdict = evaluate(measurements, {
      ...passing,
      budgets: { ...passing.budgets, "initial.js": 15_000 },
    });
    expect(verdict.failed).toBe(false);
  });

  it("fails a chunk that entered the initial graph with no ceiling", () => {
    // Without this, adding a `manualChunks` entry moves 40kB into a chunk
    // nothing is watching; only `initial.js` notices, and the obvious way to
    // make it green is to raise `initial.js` rather than add the missing line.
    const verdict = evaluate(measurements, {
      ...passing,
      budgets: Object.fromEntries(
        Object.entries(passing.budgets).filter(([id]) => id !== "chunk.router"),
      ),
    });
    expect(verdict.findings.find((f) => f.id === "chunk.router")?.status).toBe("missing-budget");
    expect(verdict.failed).toBe(true);
  });

  it("fails a ceiling that outlived the chunk it was written for", () => {
    // Harmless on its own, which is exactly why it rots: a `chunk.vendor` left
    // behind after `vendor` was renamed reads as coverage that is not there.
    const verdict = evaluate(measurements, {
      ...passing,
      budgets: { ...passing.budgets, "chunk.legacy": 1_000 },
    });
    const stale = verdict.findings.find((f) => f.id === "chunk.legacy");
    expect(stale?.status).toBe("stale-budget");
    expect(stale?.actual).toBeNull();
    expect(verdict.failed).toBe(true);
  });

  it("orders findings by id so two runs read the same way", () => {
    const ids = evaluate(measurements, passing).findings.map((f) => f.id);
    expect(ids).toEqual([...ids].sort());
  });
});

describe("ratchet", () => {
  it("writes ceilings above the build it measured", () => {
    const updated = ratchet([{ id: "initial.js", detail: "", bytes: 100_000 }], "gzip", 5);
    expect(updated.budgets["initial.js"]).toBe(105_000);
  });

  it("rounds up, so the file reads as a decision rather than a recording", () => {
    const updated = ratchet([{ id: "initial.js", detail: "", bytes: 100_001 }], "gzip", 5);
    expect(updated.budgets["initial.js"]).toBe(105_100);
  });

  it("produces a file the very next check passes", () => {
    const measurements = measureGraph(graph, ["worker.js"], sizeOf);
    const verdict = evaluate(measurements, ratchet(measurements, "gzip", 0));
    expect(verdict.failed).toBe(false);
  });
});

describe("parseBudgetFile", () => {
  const valid = JSON.stringify({
    compression: "gzip",
    budgets: { "initial.js": 1, "initial.css": 1, "lazy.largest": 1, unattributed: 1 },
  });

  it("round-trips what formatBudgetFile writes", () => {
    const parsed = parseBudgetFile(valid, "test");
    expect(parseBudgetFile(formatBudgetFile(parsed), "test")).toEqual(parsed);
  });

  it("sorts ids and ends with a newline, so prettier --check agrees with it", () => {
    const text = formatBudgetFile({
      compression: "gzip",
      budgets: { "z.b": 2, "a.a": 1 },
    });
    expect(text.endsWith("\n")).toBe(true);
    expect(text.indexOf('"a.a"')).toBeLessThan(text.indexOf('"z.b"'));
  });

  it.each(REQUIRED_IDS)("refuses a file with no %s budget", (id) => {
    const file = JSON.parse(valid) as { compression: string; budgets: Record<string, number> };
    const budgets = Object.fromEntries(Object.entries(file.budgets).filter(([key]) => key !== id));
    expect(() => parseBudgetFile(JSON.stringify({ ...file, budgets }), "test")).toThrow(
      `test: missing required budget "${id}"`,
    );
  });

  it("refuses a budget written as a string", () => {
    // `"180000" > 176_060` is a string comparison in JavaScript and is false,
    // so a lenient parser turns this gate off at any size without a word.
    expect(() =>
      parseBudgetFile(
        JSON.stringify({ compression: "gzip", budgets: { "initial.js": "180000" } }),
        "test",
      ),
    ).toThrow(/must be a non-negative integer/);
  });

  it.each([
    ["not json", "not valid JSON"],
    ['["a"]', "must contain a JSON object"],
    ['{"budgets":{}}', '"compression" must be one of'],
    ['{"compression":"gzip"}', '"budgets" must be an object'],
    ['{"compression":"lzma","budgets":{}}', '"compression" must be one of'],
  ])("rejects %s", (contents, message) => {
    expect(() => parseBudgetFile(contents, "test")).toThrow(message);
  });
});
