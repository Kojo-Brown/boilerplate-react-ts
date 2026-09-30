// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { findPhysicalDeclarations } from "./stylesheetDirection";

/**
 * The gate: `globals.css` names no physical side.
 *
 * Its sibling is the lint rule, and between them they cover the two places a
 * side can be named in this repository — a Tailwind utility in a `className`,
 * and a declaration in the one hand-written stylesheet. Neither is reachable
 * from the other's tooling: ESLint does not parse CSS, and a CSS scan cannot
 * see `ml-4`.
 *
 * The stylesheet passes today, which is the point of adding the test now. A gate
 * written after the first regression is a gate written while somebody is arguing
 * about whether to fix it.
 */
const STYLESHEET = readFileSync(
  join(fileURLToPath(new URL("../../", import.meta.url)), "src/shared/styles/globals.css"),
  "utf8",
);

describe("globals.css", () => {
  it("names no physical side", () => {
    const findings = findPhysicalDeclarations(STYLESHEET);
    expect(findings.map((f) => `${String(f.line)}: ${f.declaration} → ${f.replacement}`)).toEqual(
      [],
    );
  });
});

describe("findPhysicalDeclarations", () => {
  it("finds a physical property and names its replacement", () => {
    expect(findPhysicalDeclarations(".a {\n  margin-left: 1rem;\n}")).toEqual([
      { line: 2, declaration: "margin-left: 1rem", replacement: "margin-inline-start" },
    ]);
  });

  it("finds a physical value on a logical property", () => {
    // `text-align: left` has a logical form — `start` — and a property-name scan
    // would never see it.
    expect(findPhysicalDeclarations(".a { text-align: left; }")).toEqual([
      { line: 1, declaration: "text-align: left", replacement: "text-align: start" },
    ]);
  });

  it("leaves logical properties alone", () => {
    expect(
      findPhysicalDeclarations(`
        .a {
          margin-inline-start: 1rem;
          padding-inline-end: 2px;
          inset-inline-start: 0;
          text-align: start;
          border-inline-end: 1px solid red;
        }
      `),
    ).toEqual([]);
  });

  it("does not mistake a logical property for the physical one it contains", () => {
    // `inset-inline-start` ends in the string `start`, and `margin-inline-left`
    // is not a property — but `left` on its own is, which is why the match has to
    // be anchored to the start of a declaration.
    expect(findPhysicalDeclarations(".a { inset-inline-start: 0; }")).toEqual([]);
  });

  it("ignores a custom property that merely mentions a side", () => {
    expect(findPhysicalDeclarations(":root { --left-rail-width: 16rem; }")).toEqual([]);
  });

  it("ignores prose in a comment", () => {
    expect(
      findPhysicalDeclarations("/* margin-left: 1rem was here */\n.a { color: red; }"),
    ).toEqual([]);
  });

  it("keeps line numbers correct after a multi-line comment", () => {
    // Comments are blanked rather than deleted, so a finding after one still
    // reports the line an editor would jump to.
    const css = "/*\n\n\n*/\n.a { margin-left: 0; }";
    expect(findPhysicalDeclarations(css)[0]?.line).toBe(5);
  });

  it("allows a physical side inside a rule that names a direction", () => {
    /*
     * The escape hatch, and the reason there is one: a transform, a box shadow
     * offset or a background position has no logical form, so the only correct
     * way to write it is once per direction. A rule already scoped to `[dir=rtl]`
     * has said which one it means.
     */
    expect(
      findPhysicalDeclarations(`
        [dir="rtl"] .drawer { left: auto; right: 0; }
        :dir(ltr) .drawer { left: 0; }
      `),
    ).toEqual([]);
  });

  it("still reports a side in a rule nested inside a direction-scoped one's sibling", () => {
    const findings = findPhysicalDeclarations(`
      [dir="rtl"] .a { left: 0; }
      .b { left: 0; }
    `);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(3);
  });

  it("reports every finding, sorted by line", () => {
    const findings = findPhysicalDeclarations(`
      .a { padding-right: 1px; }
      .b { border-left: 0; }
      .c { float: right; }
    `);
    expect(findings.map((f) => f.line)).toEqual([2, 3, 4]);
  });
});
