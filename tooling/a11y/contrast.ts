/**
 * Colour maths for the token contrast gate.
 *
 * The browser audit in `e2e/a11y.spec.ts` can only judge a colour pair that
 * some audited route actually renders. A token combination nothing renders
 * today — a `danger` toast, a `warning` badge on a raised surface — is exactly
 * the one that ships broken, because the first page to use it is written long
 * after the audit was set up. This module is what lets a unit test read the
 * stylesheet and judge every pairing the system declares, whether or not it is
 * on screen anywhere.
 *
 * The conversion is OKLCH → linear sRGB → gamma-encoded sRGB → WCAG relative
 * luminance, which is the path a browser takes and the one axe-core's
 * `color-contrast` rule measures at the end of. It is deliberately not a
 * dependency: the whole of it is three matrix multiplications, and the version
 * that matters is the one whose clamping behaviour this project can read.
 */

/** A colour in the OKLCH space: lightness 0–1, chroma, hue in degrees. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

/** Gamma-encoded sRGB, each channel 0–1. */
export type Srgb = readonly [number, number, number];

/**
 * Parses the `oklch()` notation as it appears in `globals.css`.
 *
 * Accepts `oklch(55% 0.2 250)` and the alpha form `oklch(0% 0 0 / 20%)`, whose
 * alpha is dropped: a token with transparency has no contrast of its own, only
 * one against whatever it is composited over, and the gate refuses to guess at
 * that rather than report a number that is wrong in the safe-looking direction.
 */
export function parseOklch(value: string): Oklch | null {
  const match = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+%?)?\s*\)$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const [, l, c, h] = match;
  if (l === undefined || c === undefined || h === undefined) return null;
  return { l: Number(l) / 100, c: Number(c), h: Number(h) };
}

/** True when the value carries an alpha channel, which this gate will not score. */
export function hasAlpha(value: string): boolean {
  return /^oklch\([^)]*\/[^)]*\)$/.test(value.trim());
}

/**
 * OKLCH → gamma-encoded sRGB, clamped to the gamut.
 *
 * Clamping rather than gamut-mapping is correct *here* and would be wrong in a
 * renderer: an out-of-gamut token is a token whose displayed colour nobody can
 * predict, and a gate that quietly mapped it would be scoring a colour the
 * screen never shows. Every colour in this palette is in gamut, so the clamp
 * is a guard, not a code path.
 */
export function oklchToSrgb({ l, c, h }: Oklch): Srgb {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const lCone = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mCone = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sCone = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const linear = [
    4.0767416621 * lCone - 3.3077115913 * mCone + 0.2309699292 * sCone,
    -1.2684380046 * lCone + 2.6097574011 * mCone - 0.3413193965 * sCone,
    -0.0041960863 * lCone - 0.7034186147 * mCone + 1.707614701 * sCone,
  ];

  const encode = (channel: number): number => {
    const clamped = Math.min(1, Math.max(0, channel));
    return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
  };

  return [encode(linear[0] ?? 0), encode(linear[1] ?? 0), encode(linear[2] ?? 0)] as const;
}

/** WCAG 2.x relative luminance of a gamma-encoded sRGB colour. */
export function relativeLuminance([r, g, b]: Srgb): number {
  const linearize = (channel: number): number =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG 2.x contrast ratio between two colours, from 1 to 21. */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const lumA = relativeLuminance(oklchToSrgb(a));
  const lumB = relativeLuminance(oklchToSrgb(b));
  const [lighter, darker] = lumA > lumB ? [lumA, lumB] : [lumB, lumA];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Hex form of a colour, for naming the offender in a failure message. */
export function toHex(color: Oklch): string {
  return `#${oklchToSrgb(color)
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** The custom properties declared in one block of a stylesheet. */
export type TokenBlock = ReadonlyMap<string, string>;

/**
 * Reads `--color-*` declarations out of the `:root` and `.dark` blocks.
 *
 * A hand-rolled scan rather than a CSS parser, and it stays honest by being
 * narrow: it takes the text between a selector and the next `}` at the same
 * nesting depth, and it only looks at declarations whose name starts with
 * `--color-`. `globals.css` nests those blocks one level inside `@layer base`,
 * so the depth counting is what keeps `.dark` from swallowing the rest of the
 * file.
 */
export function readColorTokens(css: string, selector: string): TokenBlock {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No \`${selector}\` block in the stylesheet`);

  let depth = 0;
  let end = -1;
  for (let i = start; i < css.length; i += 1) {
    const char = css[i];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`Unterminated \`${selector}\` block`);

  const body = css.slice(start, end);
  const tokens = new Map<string, string>();
  // Comments carry example values (`3.71:1`, `neutral-500`) and would
  // otherwise be scanned as declarations.
  for (const [, name, value] of body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/(--color-[\w-]+)\s*:\s*([^;]+);/g)) {
    if (name !== undefined && value !== undefined) tokens.set(name, value.trim());
  }
  return tokens;
}

/**
 * Resolves a token to a literal colour, following `var()` indirection.
 *
 * `blocks` are consulted in order, so passing `[dark, root]` resolves a token
 * the way the cascade does for a page under `.dark`: the override if there is
 * one, the base value otherwise.
 */
export function resolveColor(name: string, blocks: readonly TokenBlock[]): Oklch {
  const seen = new Set<string>();
  let current = name;

  for (;;) {
    if (seen.has(current)) throw new Error(`Cyclic token reference at \`${current}\``);
    seen.add(current);

    const value = blocks.reduce<string | undefined>(
      (found, block) => found ?? block.get(current),
      undefined,
    );
    if (value === undefined) throw new Error(`Undeclared token \`${current}\``);

    const indirection = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
    if (indirection?.[1] !== undefined) {
      current = indirection[1];
      continue;
    }

    if (hasAlpha(value)) {
      throw new Error(`Token \`${current}\` is translucent (\`${value}\`) and cannot be scored`);
    }
    const color = parseOklch(value);
    if (color === null) {
      throw new Error(`Token \`${current}\` is not an \`oklch()\` colour (\`${value}\`)`);
    }
    return color;
  }
}
