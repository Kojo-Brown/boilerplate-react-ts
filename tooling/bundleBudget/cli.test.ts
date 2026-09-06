// @vitest-environment node
//
// The wiring test. Every other suite here exercises one pure function against
// a fixture; this one writes a build directory shaped like a real `dist/`,
// runs the command against it, and checks the exit code — the only thing CI
// actually reads.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main, parseArgs, MANIFEST_PATH, type Io } from "./cli.ts";
import { CHUNK_PREFIX, parseBudgetFile, REQUIRED_IDS } from "./evaluate.ts";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const MANIFEST = {
  "index.html": {
    file: "assets/entry.js",
    name: "index",
    isEntry: true,
    imports: ["_router.js"],
    dynamicImports: ["src/pages/a.tsx"],
    css: ["assets/entry.css"],
  },
  "_router.js": { file: "assets/router.js", name: "router" },
  "src/pages/a.tsx": {
    file: "assets/PageA.js",
    name: "PageA",
    isDynamicEntry: true,
    imports: ["index.html"],
  },
};

let root: string;
let dist: string;
let budget: string;
let out: string[];
let err: string[];
const io: Io = {
  log: (line) => out.push(line),
  error: (line) => err.push(line),
};

/** `size` compressible bytes, so gzip has something to do. */
const filler = (size: number): string => "export const a = 1;\n".repeat(size);

function writeBuild(): void {
  mkdirSync(path.join(dist, "assets"), { recursive: true });
  mkdirSync(path.join(dist, ".vite"), { recursive: true });
  writeFileSync(path.join(dist, MANIFEST_PATH), JSON.stringify(MANIFEST));
  writeFileSync(path.join(dist, "assets", "entry.js"), filler(400));
  writeFileSync(path.join(dist, "assets", "router.js"), filler(200));
  writeFileSync(path.join(dist, "assets", "PageA.js"), filler(50));
  writeFileSync(path.join(dist, "assets", "entry.css"), ".a{color:red}");
  // Present in `dist/` and absent from the manifest, like a worker chunk.
  writeFileSync(path.join(dist, "assets", "worker.js"), filler(30));
  // Present in `dist/` and downloaded by nobody.
  writeFileSync(path.join(dist, "assets", "entry.js.map"), filler(5000));
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "bundle-budget-cli-"));
  dist = path.join(root, "dist");
  budget = path.join(root, "bundle-budget.json");
  out = [];
  err = [];
  writeBuild();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Seed a budget file from the fixture build, then adjust it. */
function seed(overrides: Record<string, number | undefined> = {}): void {
  writeFileSync(
    budget,
    JSON.stringify({
      compression: "gzip",
      budgets: { "initial.js": 0, "initial.css": 0, "lazy.largest": 0, unattributed: 0 },
    }),
  );
  expect(main(["--dist", dist, "--budget", budget, "--update"], io)).toBe(0);
  const file = parseBudgetFile(readFileSync(budget, "utf8"), budget);
  const budgets = Object.fromEntries(
    Object.entries({ ...file.budgets, ...overrides }).filter(([, value]) => value !== undefined),
  );
  writeFileSync(budget, JSON.stringify({ compression: file.compression, budgets }));
}

describe("main", () => {
  it("exits 0 and prints the table when every budget is met", () => {
    seed();
    expect(main(["--dist", dist, "--budget", budget], io)).toBe(0);
    expect(out.join("\n")).toContain("PASS — every budget met.");
    expect(err).toEqual([]);
  });

  it("exits 1 when a budget is exceeded", () => {
    seed({ "initial.js": 10 });
    expect(main(["--dist", dist, "--budget", budget], io)).toBe(1);
    expect(out.join("\n")).toContain("over budget");
  });

  it("exits 1 when an initial chunk has no budget", () => {
    seed({ "chunk.router": undefined });
    expect(main(["--dist", dist, "--budget", budget], io)).toBe(1);
  });

  it("counts the worker-shaped file the manifest cannot see", () => {
    seed();
    main(["--dist", dist, "--budget", budget], io);
    expect(out.join("\n")).toContain("assets/worker.js");
  });

  it("does not count sourcemaps", () => {
    // In this repository `dist/` is roughly 80% `.map` by weight. A gate that
    // counted them would be reporting on the debug artefacts, and would go
    // green the day someone turned `build.sourcemap` off.
    seed();
    main(["--dist", dist, "--budget", budget], io);
    expect(out.join("\n")).toContain("assets/worker.js");
    expect(out.join("\n")).not.toContain(".map");
  });

  it("appends Markdown to the summary file rather than replacing it", () => {
    // `$GITHUB_STEP_SUMMARY` is one file shared by every step in the job.
    const summary = path.join(root, "summary.md");
    writeFileSync(summary, "### An earlier step\n");
    seed();
    main(["--dist", dist, "--budget", budget, "--summary", summary], io);
    const contents = readFileSync(summary, "utf8");
    expect(contents).toContain("### An earlier step");
    expect(contents).toContain("### Bundle budget");
  });

  it("writes no summary when none was asked for", () => {
    seed();
    expect(main(["--dist", dist, "--budget", budget], io)).toBe(0);
  });

  it("exits 2 with an explanation when the build has not been run", () => {
    seed();
    rmSync(dist, { recursive: true, force: true });
    expect(main(["--dist", dist, "--budget", budget], io)).toBe(2);
    expect(err.join("\n")).toContain("Run `pnpm build` first");
  });

  it("exits 2 when the build exists but carries no manifest", () => {
    seed();
    rmSync(path.join(dist, MANIFEST_PATH));
    expect(main(["--dist", dist, "--budget", budget], io)).toBe(2);
    expect(err.join("\n")).toContain("build.manifest");
  });

  it("exits 2 on an unreadable budget file, distinct from a failing build", () => {
    // 2 and 1 are different on purpose: a broken gate and a bundle that grew
    // are different problems, and a gate that reports its own misconfiguration
    // as a size regression sends someone to optimise the wrong thing.
    writeFileSync(budget, "{ not json");
    expect(main(["--dist", dist, "--budget", budget], io)).toBe(2);
  });

  it("exits 2 on an unknown flag rather than ignoring it", () => {
    expect(main(["--verbose"], io)).toBe(2);
    expect(err.join("\n")).toContain('Unknown argument "--verbose"');
  });

  it("rewrites the budget file under --update and passes on the next run", () => {
    seed({ "initial.js": 10 });
    expect(main(["--dist", dist, "--budget", budget], io)).toBe(1);
    expect(main(["--dist", dist, "--budget", budget, "--update"], io)).toBe(0);
    expect(main(["--dist", dist, "--budget", budget], io)).toBe(0);
  });
});

describe("parseArgs", () => {
  it("defaults to the paths the pnpm script relies on", () => {
    expect(parseArgs([])).toEqual({
      dist: "dist",
      budget: "bundle-budget.json",
      update: false,
      headroomPercent: 5,
      summary: null,
    });
  });

  it("rejects a flag with a missing value instead of swallowing the next flag", () => {
    expect(() => parseArgs(["--dist"])).toThrow("--dist needs a value");
  });

  it("rejects a headroom that is not a percentage", () => {
    expect(() => parseArgs(["--headroom", "later"])).toThrow("--headroom must be a percentage");
    expect(() => parseArgs(["--headroom", "-5"])).toThrow("--headroom must be a percentage");
  });
});

describe("the committed budget file", () => {
  const file = path.join(REPO_ROOT, "bundle-budget.json");

  it("parses, so a hand-edit is caught without waiting for a build", () => {
    expect(() => parseBudgetFile(readFileSync(file, "utf8"), file)).not.toThrow();
  });

  it("has no id the checker would never measure", () => {
    // A typo — `chunks.index` for `chunk.index` — is reported as a stale
    // budget, but only after a build has run. Here it costs milliseconds.
    const parsed = parseBudgetFile(readFileSync(file, "utf8"), file);
    const unknown = Object.keys(parsed.budgets).filter(
      (id) => !id.startsWith(CHUNK_PREFIX) && !(REQUIRED_IDS as readonly string[]).includes(id),
    );
    expect(unknown).toEqual([]);
  });
});
