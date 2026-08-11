// @vitest-environment node
//
// This suite reads source files and runs Babel over them; it renders nothing.
// jsdom is not just unnecessary here, it is actively wrong — under jsdom
// `import.meta.url` is not a `file:` URL and resolving paths from it throws.
import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { transformAsync } from "@babel/core";
import { reactCompilerConfig } from "../reactCompiler.config";

/**
 * The React Compiler adoption gate.
 *
 * Two things about `compilationMode: "annotation"` make an audit necessary
 * rather than nice to have:
 *
 * 1. **A failed compile is silent.** If the compiler cannot handle an
 *    annotated function it logs a `CompileError` and emits the function
 *    untouched. The build still succeeds. So a file can carry `"use memo"`,
 *    have had its `useMemo` deleted on the strength of that directive, and be
 *    shipping unmemoized — with nothing red anywhere. These tests turn that
 *    silence into a failure.
 *
 * 2. **The opt-in list is a claim about the codebase.** `docs/react-compiler.md`
 *    says which files are compiled and why the rest are not. An annotation
 *    added without updating that document makes the document wrong, so the
 *    cohort is pinned here too.
 *
 * The compiler options come from `reactCompiler.config.ts`, the same object
 * Vite and Vitest use, so this measures the real configuration.
 */

// This suite lives in `tooling/` rather than `src/` on purpose: it needs Node
// types and `@babel/core`, and `tsconfig.json` deliberately restricts the app
// program to `types: ["vite/client"]`. Widening that to let one test read the
// filesystem would hand every application file access to Node's API surface.
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(REPO_ROOT, "src");

/**
 * Every function that has opted into the compiler, and the file it lives in.
 *
 * Adding an entry here is the last step of opting a file in, not the first:
 * the file needs to lint clean under the `react-hooks` rules, and whatever
 * manual memoization comes out needs a test asserting the compiler replaced
 * it. See `docs/react-compiler.md` for the full checklist.
 */
const OPTED_IN: readonly { file: string; functions: readonly string[] }[] = [
  { file: "hooks/useFilteredSortedItems.ts", functions: ["useFilteredSortedItems"] },
  { file: "context/ThemeContext.tsx", functions: ["ThemeProvider"] },
  { file: "components/ui/Toast.tsx", functions: ["ToastProvider"] },
];

const DIRECTIVE = /(^|\n)\s*["']use memo["'];/;

interface CompilerEvent {
  kind: string;
  fnName?: string | null | undefined;
  detail?: unknown;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (/\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Runs the real compiler over one file and reports what it did. */
async function compile(absolutePath: string): Promise<CompilerEvent[]> {
  const source = await readFile(absolutePath, "utf8");
  const events: CompilerEvent[] = [];

  await transformAsync(source, {
    filename: absolutePath,
    // Parse only — the compiler runs before the JSX and TypeScript transforms
    // in the real pipeline, so it sees this same syntax.
    parserOpts: { plugins: ["jsx", "typescript"] },
    plugins: [
      [
        "babel-plugin-react-compiler",
        {
          ...reactCompilerConfig,
          logger: {
            logEvent(_filename: string | null, event: CompilerEvent) {
              events.push(event);
            },
          },
        },
      ],
    ],
    configFile: false,
    babelrc: false,
  });

  return events;
}

async function sourceFiles(): Promise<string[]> {
  const all = await walk(SRC);
  return all.filter((f) => !/\.test\.tsx?$/.test(f));
}

describe("React Compiler adoption", () => {
  it("compiles every function that opted in, with no compile errors", async () => {
    for (const { file, functions } of OPTED_IN) {
      const absolute = join(SRC, file);
      const events = await compile(absolute);

      const errors = events.filter((e) => e.kind === "CompileError");
      // A `CompileError` here is the silent-failure case: the directive is
      // present, the manual memoization is gone, and the compiler quietly
      // emitted the original function.
      expect(errors, `${file} failed to compile: ${JSON.stringify(errors)}`).toEqual([]);

      const compiled = events
        .filter((e) => e.kind === "CompileSuccess")
        .map((e) => e.fnName)
        .filter((name): name is string => typeof name === "string");

      for (const fn of functions) {
        expect(compiled, `${file} did not compile ${fn}`).toContain(fn);
      }
    }
  });

  it("compiles nothing that has not opted in", async () => {
    const optedInPaths = new Set(OPTED_IN.map(({ file }) => join(SRC, file)));
    const unexpected: string[] = [];

    for (const absolute of await sourceFiles()) {
      if (optedInPaths.has(absolute)) continue;
      const events = await compile(absolute);
      if (events.some((e) => e.kind === "CompileSuccess")) {
        unexpected.push(relative(REPO_ROOT, absolute));
      }
    }

    // This is what "incremental" means operationally: in `annotation` mode a
    // file is compiled only when it asks to be. If this ever fails, the
    // compilation mode changed and every un-audited file is now being
    // rewritten.
    expect(unexpected).toEqual([]);
  });

  it("keeps the opt-in cohort and the `use memo` directives in sync", async () => {
    const annotated: string[] = [];

    for (const absolute of await sourceFiles()) {
      const source = await readFile(absolute, "utf8");
      if (DIRECTIVE.test(source)) {
        annotated.push(relative(SRC, absolute));
      }
    }

    // Sorted so the failure message reads as a diff of the two lists rather
    // than a filesystem-order accident.
    expect(annotated.sort()).toEqual(OPTED_IN.map(({ file }) => file).sort());
  });

  it("is configured for incremental adoption against the React major in use", () => {
    expect(reactCompilerConfig.compilationMode).toBe("annotation");
    expect(reactCompilerConfig.target).toBe("19");
  });
});
