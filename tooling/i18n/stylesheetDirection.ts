/**
 * The stylesheet half of the right-to-left pass.
 *
 * `tooling/eslint/logicalProperties.ts` covers Tailwind utilities in `className`
 * strings, which is where every physical side in this application lived. It
 * cannot see a declaration written by hand in `globals.css`, and that file is
 * where the next one will be: it holds the `@theme` tokens, the base layer and
 * the handful of component rules that were easier to write as CSS than as
 * utilities, so it is the one place in `src/` a `margin-left` can be added
 * without a lint rule noticing.
 *
 * Reported as offsets into the source rather than as a boolean, so the failure
 * names the line.
 */

/** A physical CSS property and the logical property that replaces it. */
export const PHYSICAL_PROPERTIES: readonly (readonly [physical: string, logical: string])[] = [
  ["margin-left", "margin-inline-start"],
  ["margin-right", "margin-inline-end"],
  ["padding-left", "padding-inline-start"],
  ["padding-right", "padding-inline-end"],
  ["border-left", "border-inline-start"],
  ["border-right", "border-inline-end"],
  ["border-top-left-radius", "border-start-start-radius"],
  ["border-top-right-radius", "border-start-end-radius"],
  ["border-bottom-left-radius", "border-end-start-radius"],
  ["border-bottom-right-radius", "border-end-end-radius"],
  ["left", "inset-inline-start"],
  ["right", "inset-inline-end"],
];

/**
 * `text-align` and `float` values that name a side.
 *
 * Separate from the list above because the property is fine and the *value* is
 * not: `text-align: start` is the logical form of `text-align: left`, and a
 * property-name scan would never see it.
 */
export const PHYSICAL_VALUES: readonly (readonly [
  property: string,
  value: string,
  logical: string,
])[] = [
  ["text-align", "left", "start"],
  ["text-align", "right", "end"],
  ["float", "left", "inline-start"],
  ["float", "right", "inline-end"],
  ["clear", "left", "inline-start"],
  ["clear", "right", "inline-end"],
];

export interface StylesheetFinding {
  /** 1-indexed, so the message can be pasted into an editor. */
  readonly line: number;
  readonly declaration: string;
  readonly replacement: string;
}

/**
 * Strips comments, so prose about `margin-left` is not a finding.
 *
 * Replaced with an equal number of newlines rather than removed, so the line
 * numbers of everything after a block comment are still the file's.
 */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    "\n".repeat((comment.match(/\n/g) ?? []).length),
  );
}

/**
 * Every physical declaration in a stylesheet.
 *
 * The property has to be at the start of a declaration — after `{`, `;` or a
 * newline — which is what keeps `margin-inline-start` from matching `left` and
 * a custom property named `--left-rail` from matching at all. A declaration
 * inside a `[dir="ltr"]` or `[dir="rtl"]` block is left alone: naming a side
 * inside a rule that already names a direction is the deliberate escape hatch,
 * the same one the lint rule spells `ltr:` / `rtl:`.
 */
export function findPhysicalDeclarations(css: string): StylesheetFinding[] {
  const findings: StylesheetFinding[] = [];
  const source = withoutComments(css);

  for (const [physical, logical] of PHYSICAL_PROPERTIES) {
    const pattern = new RegExp(String.raw`(^|[{;\s])(${physical})\s*:\s*([^;}]*)`, "g");
    for (const match of source.matchAll(pattern)) {
      // Group 1 is the character that anchored the match to the start of a
      // declaration and may legitimately be empty (start of file), so its length
      // is what shifts the index onto the property name.
      const index = match.index + (match[1] ?? "").length;
      if (isDirectionScoped(source, index)) continue;
      findings.push({
        line: lineOf(source, index),
        declaration: `${physical}: ${(match[3] ?? "").trim()}`,
        replacement: logical,
      });
    }
  }

  for (const [property, value, logical] of PHYSICAL_VALUES) {
    const pattern = new RegExp(String.raw`(^|[{;\s])(${property})\s*:\s*(${value})\b`, "g");
    for (const match of source.matchAll(pattern)) {
      const index = match.index + (match[1] ?? "").length;
      if (isDirectionScoped(source, index)) continue;
      findings.push({
        line: lineOf(source, index),
        declaration: `${property}: ${value}`,
        replacement: `${property}: ${logical}`,
      });
    }
  }

  return findings.sort((a, b) => a.line - b.line);
}

/**
 * Whether the declaration at `index` sits inside a rule whose selector names a
 * direction.
 *
 * Read backwards to the enclosing `{` rather than by parsing the stylesheet,
 * because a CSS parser is a dependency and this question is one selector deep.
 * Nested rules are handled by the same walk: any `[dir=…]` between here and the
 * top of the file that has not been closed is an enclosing one.
 */
function isDirectionScoped(css: string, index: number): boolean {
  let depth = 0;
  for (let i = index; i >= 0; i -= 1) {
    const char = css[i];
    if (char === "}") depth += 1;
    else if (char === "{") {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      const selector = css.slice(css.lastIndexOf("}", i) + 1, i);
      if (/\[dir\s*=\s*["']?(ltr|rtl)["']?\]|:dir\(/.test(selector)) return true;
    }
  }
  return false;
}

function lineOf(css: string, index: number): number {
  return (css.slice(0, index).match(/\n/g) ?? []).length + 1;
}
