// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Nothing under `src/` imports `"zod"` for a value except `shared/config/zod.ts`.
 *
 * That module sets `jitless: true`, which each `z.object()` reads once at
 * construction and never again: a schema built from a direct `"zod"` import
 * gets a JIT-compiled parser and a `new Function` the Content-Security-Policy
 * refuses. Nothing visible happens — Zod probes, catches, and falls back to the
 * interpreted path — which is precisely why this is a gate rather than a
 * convention. The only symptom is one `securitypolicyviolation` report per page
 * load, on a channel whose value depends on being empty when nothing is wrong.
 *
 * Type-only imports are exempt, and are why the check matches the import
 * *statement* rather than the specifier: `import type { ZodError } from "zod"`
 * is erased before a module graph exists and can construct nothing.
 *
 * See `docs/csp.md`.
 */
const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const CONFIGURED_MODULE = path.join("shared", "config", "zod.ts");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Import statements naming `"zod"` that are not `import type`. */
export function valueImportsOfZod(source: string): string[] {
  return [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"zod";$/gm)].map((m) => m[0]);
}

describe("zod imports", () => {
  it("all go through shared/config/zod.ts", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !file.endsWith(CONFIGURED_MODULE))
      .flatMap((file) =>
        valueImportsOfZod(readFileSync(file, "utf8")).map(
          (statement) => `${path.relative(SRC, file)}: ${statement}`,
        ),
      );
    expect(offenders).toEqual([]);
  });

  it("counts a value import and not a type-only one", () => {
    expect(valueImportsOfZod(`import { z } from "zod";`)).toEqual([`import { z } from "zod";`]);
    expect(valueImportsOfZod(`import type { ZodError } from "zod";`)).toEqual([]);
    expect(valueImportsOfZod(`import { z } from "@/shared/config/zod";`)).toEqual([]);
  });
});
