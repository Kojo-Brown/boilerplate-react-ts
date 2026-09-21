// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  contrastRatio,
  hasAlpha,
  oklchToSrgb,
  parseOklch,
  readColorTokens,
  relativeLuminance,
  resolveColor,
  toHex,
  type Oklch,
} from "./contrast.ts";

/*
 * The colour maths behind `tokenContrast.test.ts`.
 *
 * Its own suite rather than trusting the gate to exercise it, because a gate
 * built on a broken converter fails in the direction nobody investigates: it
 * goes green. The anchors below are values with an answer outside this
 * repository — black on white is 21:1 by definition, `oklch(100% 0 0)` is
 * white because the space says so — so a rewrite of the matrices has something
 * to be wrong against.
 */

const BLACK: Oklch = { l: 0, c: 0, h: 0 };
const WHITE: Oklch = { l: 1, c: 0, h: 0 };

describe("parseOklch", () => {
  it("reads the three-component form used throughout globals.css", () => {
    expect(parseOklch("oklch(55% 0.2 250)")).toEqual({ l: 0.55, c: 0.2, h: 250 });
  });

  it("reads a value with an alpha channel, dropping the alpha", () => {
    expect(parseOklch("oklch(0% 0 0 / 20%)")).toEqual({ l: 0, c: 0, h: 0 });
  });

  it("tolerates the whitespace a formatter may introduce", () => {
    expect(parseOklch("  oklch(  98%   0   0  )  ")).toEqual({ l: 0.98, c: 0, h: 0 });
  });

  it("returns null for anything that is not an oklch colour", () => {
    expect(parseOklch("#ffffff")).toBeNull();
    expect(parseOklch("var(--color-neutral-50)")).toBeNull();
    expect(parseOklch("rgb(255 255 255)")).toBeNull();
  });
});

describe("hasAlpha", () => {
  it("distinguishes the two forms", () => {
    expect(hasAlpha("oklch(0% 0 0 / 20%)")).toBe(true);
    expect(hasAlpha("oklch(55% 0.2 250)")).toBe(false);
  });
});

describe("oklchToSrgb", () => {
  it("maps the achromatic extremes to black and white", () => {
    expect(toHex(BLACK)).toBe("#000000");
    expect(toHex(WHITE)).toBe("#ffffff");
  });

  it("agrees with the browser on a colour from the palette", () => {
    // `primary-500`. axe-core reported this element as `#0071df` while
    // measuring the checkout stepper, which is where the number comes from —
    // the converter is being checked against the engine the gate answers to.
    expect(toHex({ l: 0.55, c: 0.2, h: 250 })).toBe("#0071df");
  });

  it("clamps rather than wrapping when a colour falls outside sRGB", () => {
    const [r, g, b] = oklchToSrgb({ l: 0.6, c: 0.4, h: 145 });
    for (const channel of [r, g, b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
  });
});

describe("relativeLuminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance(oklchToSrgb(BLACK))).toBeCloseTo(0, 5);
    expect(relativeLuminance(oklchToSrgb(WHITE))).toBeCloseTo(1, 5);
  });
});

describe("contrastRatio", () => {
  it("is 21:1 between black and white", () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 1);
  });

  it("is 1:1 for a colour against itself", () => {
    expect(contrastRatio({ l: 0.55, c: 0.2, h: 250 }, { l: 0.55, c: 0.2, h: 250 })).toBeCloseTo(
      1,
      5,
    );
  });

  it("does not depend on which colour is named first", () => {
    const a: Oklch = { l: 0.18, c: 0, h: 0 };
    const b: Oklch = { l: 0.98, c: 0, h: 0 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });
});

describe("readColorTokens", () => {
  const css = `
@layer base {
  :root {
    --color-neutral-50: oklch(98% 0 0);
    --color-bg: var(--color-neutral-50);
    --radius-sm: 0.25rem;
    /* --color-ignored: oklch(50% 0 0); */
  }

  .dark {
    --color-bg: oklch(10% 0 0);
  }
}
`;

  it("reads only the --color-* declarations of the named block", () => {
    const root = readColorTokens(css, ":root");
    expect(root.get("--color-bg")).toBe("var(--color-neutral-50)");
    expect(root.has("--radius-sm")).toBe(false);
  });

  it("stops at the end of the block rather than running into the next", () => {
    // The whole point of counting braces: `:root` must not pick up `.dark`'s
    // override, or every dark-mode assertion would silently score the light
    // value.
    expect(readColorTokens(css, ":root").get("--color-bg")).toBe("var(--color-neutral-50)");
    expect(readColorTokens(css, ".dark").get("--color-bg")).toBe("oklch(10% 0 0)");
  });

  it("ignores declarations that appear inside comments", () => {
    expect(readColorTokens(css, ":root").has("--color-ignored")).toBe(false);
  });

  it("throws when the block is absent", () => {
    expect(() => readColorTokens(css, ".nope")).toThrow(/No `\.nope` block/);
  });
});

describe("resolveColor", () => {
  const root = readColorTokens(
    `:root { --color-neutral-900: oklch(18% 0 0); --color-fg: var(--color-neutral-900); --color-shadow: oklch(0% 0 0 / 20%); --color-broken: 1px solid red; --color-loop: var(--color-loop); }`,
    ":root",
  );
  const dark = readColorTokens(`.dark { --color-fg: oklch(98% 0 0); }`, ".dark");

  it("follows var() indirection to a literal", () => {
    expect(resolveColor("--color-fg", [root])).toEqual({ l: 0.18, c: 0, h: 0 });
  });

  it("lets an earlier block override a later one, as the cascade does", () => {
    expect(resolveColor("--color-fg", [dark, root])).toEqual({ l: 0.98, c: 0, h: 0 });
    expect(resolveColor("--color-fg", [root])).toEqual({ l: 0.18, c: 0, h: 0 });
  });

  it("refuses a translucent token rather than scoring it composited over nothing", () => {
    expect(() => resolveColor("--color-shadow", [root])).toThrow(/translucent/);
  });

  it("refuses a value that is not a colour", () => {
    expect(() => resolveColor("--color-broken", [root])).toThrow(/not an `oklch\(\)` colour/);
  });

  it("reports an undeclared token by name", () => {
    expect(() => resolveColor("--color-absent", [root])).toThrow(/Undeclared token/);
  });

  it("detects a cyclic reference instead of hanging", () => {
    expect(() => resolveColor("--color-loop", [root])).toThrow(/Cyclic/);
  });
});
