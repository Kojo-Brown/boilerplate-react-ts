import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildGraph, type Manifest } from "./graph.ts";
import {
  evaluate,
  formatBudgetFile,
  measureGraph,
  parseBudgetFile,
  ratchet,
  type Measurement,
} from "./evaluate.ts";
import { fileSize, isDirectory, listFiles, unattributedFiles } from "./measure.ts";
import { formatMarkdown, formatText } from "./report.ts";

/**
 * `pnpm bundle:budget` — the gate itself.
 *
 * Reads a build that already exists rather than producing one. In CI it runs
 * as a step of the `Build` job, immediately after `pnpm build`, so the gate
 * measures the artefact that job uploads and no second three-minute build is
 * needed to find out that the bundle grew.
 */

export const MANIFEST_PATH = ".vite/manifest.json";
const DEFAULT_HEADROOM_PERCENT = 5;

export interface Io {
  log: (line: string) => void;
  error: (line: string) => void;
}

interface Options {
  dist: string;
  budget: string;
  update: boolean;
  headroomPercent: number;
  summary: string | null;
}

const USAGE = `Usage: node tooling/bundleBudget/cli.ts [options]

  --dist <dir>        Build output to measure (default: dist)
  --budget <file>     Budget file (default: bundle-budget.json)
  --summary <file>    Append a Markdown report to this file (use $GITHUB_STEP_SUMMARY)
  --update            Rewrite the budget file from this build instead of checking it
  --headroom <pct>    Headroom to leave when updating (default: ${DEFAULT_HEADROOM_PERCENT})
`;

export function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    dist: "dist",
    budget: "bundle-budget.json",
    update: false,
    headroomPercent: DEFAULT_HEADROOM_PERCENT,
    summary: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg ?? ""} needs a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--dist":
        options.dist = next();
        break;
      case "--budget":
        options.budget = next();
        break;
      case "--summary":
        options.summary = next();
        break;
      case "--update":
        options.update = true;
        break;
      case "--headroom": {
        const value = Number(next());
        if (!Number.isFinite(value) || value < 0)
          throw new Error("--headroom must be a percentage");
        options.headroomPercent = value;
        break;
      }
      default:
        throw new Error(`Unknown argument "${arg ?? ""}"\n\n${USAGE}`);
    }
  }
  return options;
}

function parseManifest(contents: string, source: string): Manifest {
  const raw: unknown = JSON.parse(contents);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${source} must contain a JSON object`);
  }
  return raw as Manifest;
}

/** Measure a build directory. Exported for the end-to-end test. */
export function measureBuild(dist: string, compression: Parameters<typeof fileSize>[2]) {
  const manifestFile = path.join(dist, MANIFEST_PATH);
  let manifestSource: string;
  try {
    manifestSource = readFileSync(manifestFile, "utf8");
  } catch (cause) {
    throw new Error(
      `No build manifest at ${manifestFile}. Run \`pnpm build\` first; the manifest is what ` +
        `distinguishes a statically imported chunk from a lazily imported one, and it only ` +
        `exists because vite.config.ts sets \`build.manifest\`.`,
      { cause },
    );
  }
  const graph = buildGraph(parseManifest(manifestSource, manifestFile));
  const unattributed = unattributedFiles(listFiles(dist), graph.emittedFiles);
  return measureGraph(graph, unattributed, (file) => fileSize(dist, file, compression));
}

export function main(argv: readonly string[], io: Io): number {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  try {
    if (!isDirectory(options.dist)) {
      throw new Error(`No build output at ${options.dist}. Run \`pnpm build\` first.`);
    }
    const budgetFile = parseBudgetFile(readFileSync(options.budget, "utf8"), options.budget);
    const measurements: Measurement[] = measureBuild(options.dist, budgetFile.compression);

    if (options.update) {
      const updated = ratchet(measurements, budgetFile.compression, options.headroomPercent);
      writeFileSync(options.budget, formatBudgetFile(updated));
      io.log(
        `Wrote ${options.budget} from this build with ${options.headroomPercent}% headroom. ` +
          `Review the diff — a raised ceiling is a decision, not a formality.`,
      );
      return 0;
    }

    const verdict = evaluate(measurements, budgetFile);
    io.log(formatText(verdict));
    if (options.summary !== null) appendFileSync(options.summary, formatMarkdown(verdict));
    return verdict.failed ? 1 : 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (process.argv[1] === import.meta.filename) {
  process.exitCode = main(process.argv.slice(2), {
    log: (line) => {
      process.stdout.write(`${line}\n`);
    },
    error: (line) => {
      process.stderr.write(`${line}\n`);
    },
  });
}
