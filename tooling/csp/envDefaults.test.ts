// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { CONNECT_SRC_ENV_KEYS, ENV_FALLBACKS } from "./policy.ts";

/**
 * `ENV_FALLBACKS` says what `src/shared/config/env.ts` says.
 *
 * The two could have been one module, and a first attempt made them one. It
 * does not compile: `tsconfig.json` owns `src/` and `tsconfig.node.json` owns
 * `tooling/` and references it, so a file listed in both is an input of both
 * and `tsc` rejects the second claim. Worse, it rejects it *conditionally* —
 * the shared module type-checked locally, where a previous `tsc -b` had left
 * the declaration behind, and failed in CI where `.tsbuildinfo/` does not
 * exist. A gate that is a text match is the honest answer to a boundary that
 * is real.
 *
 * What it protects is not cosmetic. A default is a value the bundle uses and
 * the build cannot see: an unset variable is absent from Vite's resolved env
 * and present in `import.meta.env`, because the schema fills it in. Drift here
 * is a `connect-src` that does not name the origin the application fetches,
 * which fails in production only. See `docs/csp.md`.
 */
const ENV_MODULE = fileURLToPath(new URL("../../src/shared/config/env.ts", import.meta.url));

/**
 * The literal a key is defaulted to in the schema, or `null`.
 *
 * The lookahead is what keeps a key's match inside its own entry: without it,
 * a key written without a default would borrow the next key's.
 */
export function declaredDefault(source: string, key: string): string | null {
  const pattern = new RegExp(
    `\\b${key}\\s*:((?:(?!VITE_)[\\s\\S])*?)\\.default\\(\\s*"([^"]*)"\\s*\\)`,
  );
  return pattern.exec(source)?.[2] ?? null;
}

describe("declaredDefault", () => {
  it("reads a default through a chain and through a union", () => {
    expect(declaredDefault(`VITE_API_URL: z.url().default("http://x"),`, "VITE_API_URL")).toBe(
      "http://x",
    );
    expect(
      declaredDefault(
        `VITE_ANALYTICS_URL: z.union([z.literal(""), z.url()]).default(""),`,
        "VITE_ANALYTICS_URL",
      ),
    ).toBe("");
  });

  it("does not let a key borrow the next key's default", () => {
    expect(
      declaredDefault(
        `VITE_API_URL: z.url(),\n  VITE_OTHER: z.string().default("x"),`,
        "VITE_API_URL",
      ),
    ).toBeNull();
  });

  it("reports a default that is not a literal, rather than inventing one", () => {
    expect(
      declaredDefault(`VITE_API_URL: z.url().default(SOMEWHERE_ELSE),`, "VITE_API_URL"),
    ).toBeNull();
  });
});

describe("ENV_FALLBACKS", () => {
  const source = readFileSync(ENV_MODULE, "utf8");

  it.each([...CONNECT_SRC_ENV_KEYS])("matches the schema's default for %s", (key) => {
    expect(declaredDefault(source, key), `no literal default for ${key} in env.ts`).toBe(
      ENV_FALLBACKS[key],
    );
  });
});
