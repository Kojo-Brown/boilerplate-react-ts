// @vitest-environment node
//
// Reads a stylesheet off disk and does arithmetic; it renders nothing, and
// under jsdom `import.meta.url` is not a `file:` URL, so resolving the path
// from it throws.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { contrastRatio, readColorTokens, resolveColor, toHex } from "./contrast.ts";

/**
 * The design-token half of the WCAG 2.2 AA gate.
 *
 * `e2e/a11y.spec.ts` is the other half, and neither subsumes the other. The
 * browser audit judges what a route renders, including the contrast a
 * component creates by composing tokens the system never paired on purpose —
 * but it is blind to a pairing no audited page happens to show. This suite is
 * the mirror image: it cannot see a page at all, and it judges every
 * combination the system *declares*, in both themes, in about a millisecond.
 *
 * The practical difference is when the failure arrives. A token edit that
 * drops `--color-muted-fg` below 4.5:1 fails here, in `pnpm test`, naming the
 * token and the ratio. Without this suite the same edit is caught a job later
 * by axe, as a hundred and eighty violations across twenty-one routes, each
 * pointing at an element rather than at the one line that caused it.
 */

const AA_TEXT = 4.5;
const AA_LARGE_TEXT = 3;
const AA_NON_TEXT = 3;

const css = readFileSync(
  join(fileURLToPath(new URL("../../", import.meta.url)), "src/shared/styles/globals.css"),
  "utf8",
);

const root = readColorTokens(css, ":root");
const dark = readColorTokens(css, ".dark");

/** Light mode reads `:root`; dark mode reads `.dark` first and falls back. */
const THEMES = {
  light: [root],
  dark: [dark, root],
} as const;

/** Every surface a foreground token is allowed to land on. */
const SURFACES = [
  "--color-bg",
  "--color-bg-subtle",
  "--color-muted",
  "--color-surface",
  "--color-surface-raised",
] as const;

interface Pairing {
  /** What the token is for, as it reads in a failure message. */
  readonly what: string;
  readonly foreground: string;
  readonly backgrounds: readonly string[];
  readonly minimum: number;
}

/*
 * What the system promises, pair by pair.
 *
 * The list is the point of the suite, not boilerplate around it: a foreground
 * token that is missing here is a token nothing checks, so adding one to
 * `globals.css` without adding it here is the failure mode this suite has to
 * be read to avoid — which is why `every declared foreground is scored` below
 * turns that omission into a red test rather than a silent gap.
 */
const PAIRINGS: readonly Pairing[] = [
  {
    what: "body text",
    foreground: "--color-fg",
    backgrounds: SURFACES,
    minimum: AA_TEXT,
  },
  {
    what: "secondary text",
    foreground: "--color-fg-subtle",
    backgrounds: SURFACES,
    minimum: AA_TEXT,
  },
  {
    what: "muted text — captions, helper text, inactive nav",
    foreground: "--color-muted-fg",
    backgrounds: SURFACES,
    minimum: AA_TEXT,
  },
  /*
   * The `-strong` family is scored at 4.5:1 rather than the 3:1 an icon alone
   * would answer to, because each one is a text colour somewhere: `danger` in
   * a field error, `primary` in the checkout stepper, and — for the two that
   * are only ever glyphs today — because the next use of a token named for
   * being the readable one will be text, and nobody will re-derive the
   * threshold first. `*-subtle` is in the backgrounds because that is what a
   * toast paints its panel with.
   */
  {
    what: "brand blue as a foreground",
    foreground: "--color-primary-strong",
    backgrounds: [...SURFACES, "--color-primary-subtle"],
    minimum: AA_TEXT,
  },
  {
    what: "danger as a foreground — field errors, the error-boundary glyph",
    foreground: "--color-danger-strong",
    backgrounds: [...SURFACES, "--color-danger-subtle"],
    minimum: AA_TEXT,
  },
  {
    what: "success as a foreground — the toast glyph and its border",
    foreground: "--color-success-strong",
    backgrounds: [...SURFACES, "--color-success-subtle"],
    minimum: AA_TEXT,
  },
  {
    what: "warning as a foreground — the toast glyph, the offline banner border",
    foreground: "--color-warning-strong",
    backgrounds: [...SURFACES, "--color-warning-subtle"],
    minimum: AA_TEXT,
  },
  {
    what: "label on a filled primary control",
    foreground: "--color-primary-fg",
    backgrounds: ["--color-primary", "--color-primary-hover"],
    minimum: AA_TEXT,
  },
  {
    what: "label on a filled danger control",
    foreground: "--color-danger-fg",
    backgrounds: ["--color-danger", "--color-danger-hover"],
    minimum: AA_TEXT,
  },
  {
    what: "label on a filled success control",
    foreground: "--color-success-fg",
    backgrounds: ["--color-success", "--color-success-hover"],
    minimum: AA_TEXT,
  },
  {
    what: "label on a filled warning control",
    foreground: "--color-warning-fg",
    backgrounds: ["--color-warning", "--color-warning-hover"],
    minimum: AA_TEXT,
  },
  /*
   * 3:1, not 4.5:1, and the difference is the success criterion rather than a
   * concession. 1.4.11 governs the boundary of a control and the focus ring
   * drawn around it — graphics, not glyphs. These two tokens are strokes:
   * `--color-primary` is the focus ring every control draws, `--color-danger`
   * the outline an invalid `<Input>` takes. Neither carries text; the
   * `-strong` pair above is what does.
   */
  {
    what: "the focus ring every control draws",
    foreground: "--color-primary",
    backgrounds: SURFACES,
    minimum: AA_NON_TEXT,
  },
  {
    what: "the outline of an invalid field",
    foreground: "--color-danger",
    backgrounds: SURFACES,
    minimum: AA_NON_TEXT,
  },
  {
    what: "a border that has to be seen — the offline banner's buttons",
    foreground: "--color-border-strong",
    backgrounds: SURFACES,
    minimum: AA_NON_TEXT,
  },
];

/*
 * `--color-success` and `--color-warning` are absent from the list above as
 * foregrounds, and that is a claim rather than an oversight: they are only
 * ever fills — a `<Badge>`'s background — and a badge's fill against the page
 * behind it is not something 1.4.11 asks 3:1 of, because nothing about
 * identifying a control depends on seeing it. What the criterion does reach is
 * the label printed on that fill, which is the `*-fg` pairing above, and the
 * border or glyph beside it, which is the `-strong` pairing. `--color-warning`
 * would fail a 3:1 claim on a light surface at 2.02:1 — the honest reading is
 * that amber cannot be a stroke on white at this lightness, which is precisely
 * why `--color-warning-strong` exists and why the toast border uses it.
 */

describe.each(Object.keys(THEMES) as (keyof typeof THEMES)[])("%s theme", (theme) => {
  const blocks = THEMES[theme];

  describe.each(PAIRINGS)("$foreground — $what", ({ foreground, backgrounds, minimum }) => {
    it.each(backgrounds)(`meets ${minimum}:1 on %s`, (background) => {
      const fg = resolveColor(foreground, blocks);
      const bg = resolveColor(background, blocks);
      const ratio = contrastRatio(fg, bg);

      expect(
        Number(ratio.toFixed(2)),
        `${foreground} (${toHex(fg)}) on ${background} (${toHex(bg)}) in ${theme} mode`,
      ).toBeGreaterThanOrEqual(minimum);
    });
  });

  it("scores every foreground token the system declares", () => {
    /*
     * The guard that keeps the table above from going stale. A `*-fg` or
     * `*-strong` token is a foreground by name, so adding one to `globals.css`
     * and forgetting it here is a failing test rather than an unscored colour.
     */
    const declared = [...root.keys(), ...dark.keys()].filter(
      (name) => name.endsWith("-fg") || name.endsWith("-strong"),
    );
    const scored = new Set(PAIRINGS.map((pairing) => pairing.foreground));

    expect([...new Set(declared)].filter((name) => !scored.has(name))).toEqual([]);
  });

  it("involves every semantic fill on one side of a pairing or the other", () => {
    // A fill is scored as the background its label sits on. This catches the
    // other direction of the same drift: a new semantic colour that no
    // pairing mentions at all.
    const fills = ["--color-primary", "--color-danger", "--color-success", "--color-warning"];
    const mentioned = new Set(
      PAIRINGS.flatMap((pairing) => [pairing.foreground, ...pairing.backgrounds]),
    );

    expect(fills.filter((name) => !mentioned.has(name))).toEqual([]);
  });
});

describe("large text", () => {
  it("is held to 3:1 rather than 4.5:1, and nothing in this system relies on it", () => {
    /*
     * 1.4.3 relaxes to 3:1 at 18pt, or 14pt bold. The audit found the muted
     * ramp failing at 14px bold — `<strong>` inside muted body copy — which is
     * *below* the bold threshold, so the relaxation never applied and the
     * failure was real. Every pairing above is therefore scored at the strict
     * number; this test records the threshold so a future reader does not have
     * to re-derive why no exemption is claimed anywhere.
     */
    expect(AA_LARGE_TEXT).toBeLessThan(AA_TEXT);
  });
});
