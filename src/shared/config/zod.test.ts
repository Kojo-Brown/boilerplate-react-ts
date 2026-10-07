import { describe, it, expect } from "vitest";
import { z } from "@/shared/config/zod";

/**
 * Importing this module is what turns the JIT off, so the test is the
 * behaviour rather than the call: `globalConfig.jitless` is what every
 * `z.object()` reads at construction, and a schema that still parses is the
 * half a configuration flag can quietly take away.
 *
 * `tooling/csp/zodImports.test.ts` holds the other half — that no module
 * reaches past this one to `"zod"` directly. It lives in `tooling/` because it
 * reads the source tree, and `src/` is compiled without Node's types.
 */
describe("the one configured Zod", () => {
  it("has the JIT object parser off, so no schema reaches for `new Function`", async () => {
    const { globalConfig } = (await import("zod/v4/core")) as unknown as {
      globalConfig: { jitless?: boolean };
    };
    expect(globalConfig.jitless).toBe(true);
  });

  it("still parses", () => {
    expect(z.object({ a: z.string() }).parse({ a: "x" })).toEqual({ a: "x" });
  });
});
