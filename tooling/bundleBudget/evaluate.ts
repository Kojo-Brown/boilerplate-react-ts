import type { BundleGraph } from "./graph.ts";
import { isCompression, type Compression } from "./measure.ts";

/**
 * The budget file, and what it means to fail it.
 *
 * `bundle-budget.json` is a flat map of id to a ceiling in compressed bytes.
 * Flat and absolute, rather than a percentage against a stored baseline, for
 * one reason: a baseline has to live somewhere, and every place it can live is
 * worse than the diff. A CI artefact from `main` expires and is missing on the
 * first build after a cache eviction, at which point the gate degrades to
 * "pass" exactly when nobody is watching. A committed baseline that a bot
 * updates on every merge is a number nobody reviews. A ceiling reviewed in the
 * pull request that raises it is the only version where a human is asked
 * whether the extra 12kB was worth it.
 *
 * The cost is that a regression which stays under the ceiling passes, so the
 * ceilings are set with a few per cent of headroom rather than a comfortable
 * round number, and `--update` exists to ratchet them back down after a win.
 */

export const REQUIRED_IDS = ["initial.js", "initial.css", "lazy.largest", "unattributed"] as const;

/** Prefix for the per-chunk ceilings, one per chunk in the initial graph. */
export const CHUNK_PREFIX = "chunk.";

export interface BudgetFile {
  compression: Compression;
  budgets: Readonly<Record<string, number>>;
}

export interface Measurement {
  id: string;
  /** What the number is about, for the report: a route name, a file count. */
  detail: string;
  bytes: number;
}

export type FindingStatus = "ok" | "over" | "missing-budget" | "stale-budget";

export interface Finding {
  id: string;
  detail: string;
  status: FindingStatus;
  /** Measured bytes, or `null` for a budget with nothing left to measure. */
  actual: number | null;
  /** Budgeted bytes, or `null` for a measurement nothing has budgeted. */
  budget: number | null;
}

export interface Verdict {
  compression: Compression;
  findings: readonly Finding[];
  failed: boolean;
}

/** Reads the compressed size of one emitted file. Injected so the evaluation is pure. */
export type SizeOf = (file: string) => number;

const sum = (files: readonly string[], sizeOf: SizeOf): number =>
  files.reduce((total, file) => total + sizeOf(file), 0);

/**
 * Every number the gate has an opinion about.
 *
 * `initial.js` is the headline and is deliberately redundant with the
 * `chunk.*` entries that make it up. Keeping both is what closes the loophole
 * in per-chunk budgets: a chunk that grows past its ceiling can be brought
 * back under it by splitting it in two, which changes the number of requests
 * and nothing else. The sum does not move, so the sum is what is budgeted; the
 * per-chunk entries are there to say *where* it moved.
 */
export function measureGraph(
  graph: BundleGraph,
  unattributed: readonly string[],
  sizeOf: SizeOf,
): Measurement[] {
  const measurements: Measurement[] = [
    {
      id: "initial.js",
      detail: `${graph.initialChunks.length} chunk${graph.initialChunks.length === 1 ? "" : "s"}`,
      bytes: sum(
        graph.initialChunks.map((c) => c.file),
        sizeOf,
      ),
    },
    {
      id: "initial.css",
      detail: `${graph.initialCss.length} file${graph.initialCss.length === 1 ? "" : "s"}`,
      bytes: sum(graph.initialCss, sizeOf),
    },
  ];

  const seen = new Set<string>();
  for (const chunk of graph.initialChunks) {
    const id = `${CHUNK_PREFIX}${chunk.name}`;
    // Two initial chunks sharing a budget id would silently budget only one of
    // them. It cannot happen with Rollup's own names, and it can happen the
    // moment `manualChunks` is given a function that returns a constant.
    if (seen.has(id)) throw new Error(`Two chunks in the initial graph are both named "${id}".`);
    seen.add(id);
    measurements.push({ id, detail: chunk.file, bytes: sizeOf(chunk.file) });
  }

  const routes = graph.lazyRoutes
    .map((route) => ({ name: route.name, bytes: sum(route.files, sizeOf) }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  const largest = routes[0];
  measurements.push({
    id: "lazy.largest",
    detail: largest === undefined ? "no lazy routes" : largest.name,
    bytes: largest?.bytes ?? 0,
  });

  measurements.push({
    id: "unattributed",
    detail:
      unattributed.length === 0
        ? "none"
        : `${unattributed.length} file${unattributed.length === 1 ? "" : "s"}: ${unattributed.join(", ")}`,
    bytes: sum(unattributed, sizeOf),
  });

  return measurements;
}

/**
 * Compare measurements against the budget file.
 *
 * Three ways to fail, and the last two are the ones that keep the first
 * meaningful over time:
 *
 * - **over** — the measurement exceeds its ceiling.
 * - **missing-budget** — a chunk entered the initial graph with no ceiling.
 *   Without this, `manualChunks` gains an entry, 40kB moves into a chunk
 *   nothing is watching, `initial.js` catches it, and the obvious fix is to
 *   raise `initial.js` rather than to add the missing line.
 * - **stale-budget** — a ceiling outlived the chunk it was written for.
 *   Harmless on its own, which is why it rots: a `chunk.vendor` left behind
 *   after `vendor` was renamed reads as coverage that no longer exists.
 */
export function evaluate(measurements: readonly Measurement[], file: BudgetFile): Verdict {
  const findings: Finding[] = [];
  const measured = new Set<string>();

  for (const measurement of measurements) {
    measured.add(measurement.id);
    const budget = file.budgets[measurement.id];
    if (budget === undefined) {
      findings.push({
        ...measurement,
        actual: measurement.bytes,
        budget: null,
        status: "missing-budget",
      });
      continue;
    }
    findings.push({
      id: measurement.id,
      detail: measurement.detail,
      actual: measurement.bytes,
      budget,
      status: measurement.bytes > budget ? "over" : "ok",
    });
  }

  for (const [id, budget] of Object.entries(file.budgets)) {
    if (measured.has(id)) continue;
    findings.push({
      id,
      detail: id.startsWith(CHUNK_PREFIX)
        ? "chunk is no longer in the initial graph"
        : "nothing measured under this id",
      actual: null,
      budget,
      status: "stale-budget",
    });
  }

  findings.sort((a, b) => a.id.localeCompare(b.id));
  return {
    compression: file.compression,
    findings,
    failed: findings.some((f) => f.status !== "ok"),
  };
}

/** The budget file this run would have passed, for `--update`. */
export function ratchet(
  measurements: readonly Measurement[],
  compression: Compression,
  headroomPercent: number,
): BudgetFile {
  const budgets: Record<string, number> = {};
  for (const measurement of measurements) {
    // Rounded up to the next 100 bytes so the file reads as a decision rather
    // than as a recording of one particular build.
    const withHeadroom = measurement.bytes * (1 + headroomPercent / 100);
    budgets[measurement.id] = Math.ceil(withHeadroom / 100) * 100;
  }
  return { compression, budgets };
}

/**
 * Parse and validate `bundle-budget.json`.
 *
 * Strict, because every lenient reading of this file turns the gate off
 * without turning anything red: a missing `budgets` key read as `{}` makes
 * every measurement unbudgeted, and a budget of `"180000"` compared with `>`
 * against a number does the string comparison and passes at 900kB.
 */
export function parseBudgetFile(contents: string, source: string): BudgetFile {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch (cause) {
    throw new Error(`${source} is not valid JSON`, { cause });
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${source} must contain a JSON object`);
  }
  const record = raw as Record<string, unknown>;
  const { compression, budgets } = record;
  if (!isCompression(compression)) {
    throw new Error(`${source}: "compression" must be one of gzip, brotli, none`);
  }
  if (typeof budgets !== "object" || budgets === null || Array.isArray(budgets)) {
    throw new Error(`${source}: "budgets" must be an object of id to byte count`);
  }
  const parsed: Record<string, number> = {};
  for (const [id, value] of Object.entries(budgets)) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new Error(
        `${source}: budget "${id}" must be a non-negative integer, got ${JSON.stringify(value)}`,
      );
    }
    parsed[id] = value;
  }
  for (const id of REQUIRED_IDS) {
    if (!(id in parsed)) throw new Error(`${source}: missing required budget "${id}"`);
  }
  return { compression, budgets: parsed };
}

/** Serialise a budget file the way the repository stores it. */
export function formatBudgetFile(file: BudgetFile): string {
  const ids = Object.keys(file.budgets).sort();
  const budgets: Record<string, number> = {};
  for (const id of ids) budgets[id] = file.budgets[id] ?? 0;
  return `${JSON.stringify({ compression: file.compression, budgets }, null, 2)}\n`;
}
