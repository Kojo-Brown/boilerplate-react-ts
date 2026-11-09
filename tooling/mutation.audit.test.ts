// @vitest-environment node
//
// This suite reads source files from disk; it renders nothing. jsdom is not
// just unnecessary here, it is actively wrong — under jsdom `import.meta.url`
// is not a `file:` URL and resolving paths from it throws.
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Keeps `stryker.config.mjs`, `docs/mutation-testing.md` and the `mutation` CI
 * job from drifting apart.
 *
 * The config carries two claims a reviewer cannot verify by reading it: that
 * the modules in `mutate` exist, and that the document still describes the
 * scope and threshold the gate actually runs under. Both go stale in the same
 * quiet way — a module is renamed, a threshold is nudged — and nothing else
 * would notice: `pnpm lint` does not read markdown, and `pnpm test:mutation`
 * passes whether or not the document still describes the config it ran under.
 *
 * This matters more here than for most configuration. The documented escape
 * hatch for a red mutation run is "add the survivor to the equivalent-mutants
 * list with the argument for why", and the thing that list exists to
 * discourage is lowering `thresholds.break` or dropping a module from
 * `mutate`. A check that the document and the config still agree is what keeps
 * that from being advice nobody is held to.
 *
 * What it cannot cover is whether the reasoning in the survivor list is still
 * correct — that is a claim about program equivalence, and the only way to
 * check one is to read the code. A row that has gone wrong shows up as a score
 * that moved, which is what `thresholds.break` is for.
 *
 * It deliberately does not run Stryker. The gate is its own CI job; this is
 * milliseconds of filesystem reads in the unit suite.
 */

// This suite lives in `tooling/` rather than `src/` on purpose: it needs Node
// types to read the filesystem, and `tsconfig.json` deliberately restricts the
// app program to `types: ["vite/client"]`. Widening that to let one test read a
// file would hand every application file access to Node's API surface.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const DOC_PATH = "docs/mutation-testing.md";

/**
 * The scope entries are plain paths, so the document's scope table can list
 * them and this suite can check each one is really a file. `thresholds.break`
 * is what makes the gate a gate rather than a report.
 */
interface StrykerConfig {
  readonly mutate: readonly string[];
  readonly plugins: readonly string[];
  readonly coverageAnalysis: string;
  readonly vitest: { readonly configFile: string };
  readonly thresholds: { readonly break: number };
}

const read = (relativePath: string): Promise<string> =>
  readFile(join(repoRoot, relativePath), "utf8");

const doc = await read(DOC_PATH);
const workflow = await read(".github/workflows/ci.yml");
const packageJson = await read("package.json");

/*
 * The config, evaluated rather than parsed.
 *
 * The specifier is built at run time so this stays an `import()` of a value
 * rather than a static dependency on a `.mjs` module with no declarations —
 * which is what `import config from "../stryker.config.mjs"` would be, and
 * which `tsc --noEmit` types as `error` and the lint rules then reject.
 */
const configUrl = pathToFileURL(join(repoRoot, "stryker.config.mjs")).href;
const config = ((await import(configUrl)) as { default: StrykerConfig }).default;

describe("stryker.config.mjs", () => {
  it("mutates modules that exist", async () => {
    // A renamed module does not fail the gate, it silently leaves the file
    // unmeasured: Stryker reports "Found 7 of 664 files to be mutated" and
    // exits 0 on whatever is left, with a score that went up.
    expect(config.mutate.length).toBeGreaterThan(0);

    for (const target of config.mutate) {
      expect(target, `${target} is a glob, which the doc's scope table cannot list`).not.toMatch(
        /[*?[\]{}]/,
      );
      await expect(
        read(target),
        `stryker.config.mjs mutates missing ${target}`,
      ).resolves.toBeTypeOf("string");
    }
  });

  it("names the Vitest config the unit suite uses, and that config exists", async () => {
    // A second config here would measure a suite nobody runs.
    expect(config.vitest.configFile).toBe("vitest.config.ts");
    await expect(read(config.vitest.configFile)).resolves.toBeTypeOf("string");
  });

  it("declares the runner plugin explicitly, because pnpm defeats the default glob", () => {
    /*
     * Not cosmetic. Stryker's default plugin glob resolves against
     * `node_modules/@stryker-mutator/*`, which under pnpm holds only direct
     * dependencies as symlinks; the glob walks the real paths under `.pnpm`
     * and comes back empty. The failure reads like a missing dependency and is
     * not one, so the explicit list is load-bearing.
     */
    expect(config.plugins).toContain("@stryker-mutator/vitest-runner");

    const { devDependencies } = JSON.parse(packageJson) as {
      devDependencies: Record<string, string>;
    };
    expect(devDependencies).toHaveProperty("@stryker-mutator/vitest-runner");
    expect(devDependencies).toHaveProperty("@stryker-mutator/core");
  });

  it("keeps a break threshold, which is the whole point of the gate", () => {
    // Without `break`, Stryker prints a score and exits 0 — a report, not a
    // gate. `high`/`low` only colour the HTML report and cannot fail a build.
    expect(config.thresholds.break).toBeTypeOf("number");
    expect(config.thresholds.break).toBeGreaterThan(0);
  });

  it("runs per-test coverage analysis, without which it does not finish", () => {
    // The unit suite is jsdom and takes about two and a half minutes. Paying
    // that per mutant rather than once is the difference between a
    // four-minute job and a day.
    expect(config.coverageAnalysis).toBe("perTest");
  });
});

describe(DOC_PATH, () => {
  it("documents the threshold the config enforces", () => {
    /*
     * The number in the prose is what a reader trusts without running
     * anything, and the document spends a section arguing against lowering it.
     * A threshold changed in the config and not here leaves that argument
     * attached to a number no longer in force.
     */
    expect(doc).toContain(`\`thresholds.break\` is ${String(config.thresholds.break)}`);
  });

  it("lists every module in the mutation scope", () => {
    // The scope table is the document's claim about what is measured. A module
    // added to the config and not to the table is measured but undocumented.
    for (const target of config.mutate) {
      expect(doc, `${target} is in \`mutate\` but not in ${DOC_PATH}`).toContain(target);
    }
  });

  it("mentions no module the config does not mutate", () => {
    /*
     * The other direction, and the one that catches a module quietly dropped
     * from `mutate` to recover a threshold: the table would still show it,
     * with the score it had on the day it was removed.
     *
     * Scoped to `src/` paths, so prose about `vitest.config.ts` or the sandbox
     * does not read as a claim about scope.
     */
    const scope = new Set(config.mutate);
    const mentioned = new Set(doc.match(/src\/[\w/]+\.ts/g) ?? []);

    for (const path of mentioned) {
      expect(scope.has(path), `${DOC_PATH} refers to ${path}, not in \`mutate\``).toBe(true);
    }
  });
});

describe("the mutation gate is wired up", () => {
  it("is a script, so the config is not invoked a second way in CI", () => {
    const { scripts } = JSON.parse(packageJson) as { scripts: Record<string, string> };
    expect(scripts["test:mutation"]).toBe("stryker run");
  });

  it("runs in CI as its own job", () => {
    // A gate nothing invokes is a gate that passes. The job is separate from
    // Unit Tests so that "Mutation Score" red against "Unit Tests" green reads
    // off the checks list as "an assertion was weakened".
    expect(workflow).toContain("pnpm test:mutation");
    expect(workflow).toMatch(/^ {2}mutation:$/m);
  });

  it("keeps Stryker's sandbox out of every tool that walks the tree", async () => {
    /*
     * `.stryker-tmp/` is a complete second copy of the project with mutant
     * switches spliced into every source file. Left in Vitest's scope, the
     * first `pnpm test` after a mutation run collects both copies of every
     * suite; left in ESLint's, it reports this project's code back with the
     * instrumentation in it. It is gitignored, so this only bites locally —
     * which is worse, because CI stays green while the local run does not.
     */
    const temp = ".stryker-tmp";
    expect(await read("vitest.config.ts")).toContain(`${temp}/**`);
    expect(await read("eslint.config.ts")).toContain(temp);
    expect(await read(".prettierignore")).toContain(temp);
    expect(await read(".gitignore")).toContain(temp);
  });
});
