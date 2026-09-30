// @vitest-environment node
//
// `RuleTester` parses and lints source strings; there is no DOM in sight, and
// the default jsdom environment only slows it down.
import { describe, it, expect } from "vitest";
import { Linter, RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import {
  i18nPlugin,
  inspectClassString,
  inspectToken,
  logicalProperties,
  splitToken,
} from "./logicalProperties";

/**
 * Two layers of test, because the rule has two separable jobs.
 *
 * `inspectToken` decides whether one Tailwind token names a physical side, and it
 * is tested against tokens — including the awkward spellings (`md:hover:-ml-4!`,
 * `[&:has(:checked)]:pl-2`) whose only interesting property is how they are
 * *written*.
 *
 * The rule decides which strings in a file are class lists at all, and that is
 * tested through `RuleTester` on real source. It is the half that matters most:
 * a rule that read every string literal would report `ArrowLeft` and the word
 * "right" in a comment, and a rule that reported those would be switched off
 * within a week.
 */
const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser as unknown as NonNullable<
      ConstructorParameters<typeof RuleTester>[0]
    >["languageOptions"] extends { parser?: infer P }
      ? P
      : never,
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe("splitToken", () => {
  it("separates variants, negation, utility and importance", () => {
    expect(splitToken("md:hover:-ml-4!")).toEqual({
      variants: ["md", "hover"],
      negated: true,
      utility: "ml-4",
      important: true,
    });
  });

  it("splits on the last colon, so an arbitrary variant survives", () => {
    // `[&:has(:checked)]:pl-2` contains three colons and one variant. Splitting
    // on the first would call `[&` a variant and `has(` the utility.
    expect(splitToken("[&:has(:checked)]:pl-2")).toMatchObject({
      utility: "pl-2",
      variants: ["[&", "has(", "checked)]"],
    });
  });

  it("handles a bare utility", () => {
    expect(splitToken("ms-4")).toEqual({
      variants: [],
      negated: false,
      utility: "ms-4",
      important: false,
    });
  });
});

describe("inspectToken", () => {
  it.each([
    ["ml-4", "ms-4"],
    ["mr-2", "me-2"],
    ["pl-5", "ps-5"],
    ["pr-1", "pe-1"],
    ["left-0", "start-0"],
    ["right-4", "end-4"],
    ["text-left", "text-start"],
    ["text-right", "text-end"],
    ["float-right", "float-end"],
    ["clear-left", "clear-start"],
    ["border-l", "border-s"],
    ["border-r-2", "border-e-2"],
    ["rounded-l", "rounded-s"],
    ["rounded-tr-md", "rounded-se-md"],
    ["scroll-pl-4", "scroll-ps-4"],
    ["ml-auto", "ms-auto"],
    ["ml-[3px]", "ms-[3px]"],
  ])("%s → %s", (token, replacement) => {
    expect(inspectToken(token)).toEqual({ token, messageId: "logicalTwin", replacement });
  });

  it("puts the variants, the negation and the importance back", () => {
    // A suggestion the author cannot paste is a suggestion they will rewrite by
    // hand, which is where the second mistake comes from.
    expect(inspectToken("md:focus:-mr-2!")?.replacement).toBe("md:focus:-me-2!");
  });

  it.each([
    "ms-4",
    "me-auto",
    "ps-2",
    "pe-2",
    "start-0",
    "end-4",
    "text-start",
    "text-end",
    "border-s",
    "rounded-e",
    "mx-4",
    "px-4",
    "inset-x-0",
    "gap-3",
    "flex",
    "",
    // Not the `pr` family: the prefix scan requires a value after a `-`, which
    // is what keeps ordinary words out.
    "press-start",
    "prose-sm",
    "min-w-0",
  ])("says nothing about %s", (token) => {
    expect(inspectToken(token)).toBeNull();
  });

  describe("translate-x", () => {
    it("is reported when it does not say which direction it is for", () => {
      // There is no `translate-inline-start`, so the only way to express "off
      // screen towards the edge it is anchored to" is a pair of variants.
      expect(inspectToken("-translate-x-full")).toMatchObject({
        messageId: "needsDirectionVariant",
      });
    });

    it("is accepted once it carries a direction variant", () => {
      expect(inspectToken("ltr:-translate-x-full")).toBeNull();
      expect(inspectToken("rtl:translate-x-full")).toBeNull();
      expect(inspectToken("md:ltr:-translate-x-1/2")).toBeNull();
    });

    it("leaves zero alone", () => {
      // Zero displacement is the same displacement in both directions, and
      // `md:translate-x-0` is how a drawer says "on a desktop, in flow".
      expect(inspectToken("translate-x-0")).toBeNull();
      expect(inspectToken("md:translate-x-0")).toBeNull();
    });
  });
});

describe("inspectClassString", () => {
  it("reports every offending token in a list", () => {
    expect(inspectClassString("flex ml-4 gap-2 text-right").map((f) => f.token)).toEqual([
      "ml-4",
      "text-right",
    ]);
  });

  it("tolerates the whitespace a formatter introduces", () => {
    expect(inspectClassString("  flex\n  ml-4  ").map((f) => f.token)).toEqual(["ml-4"]);
  });
});

describe("i18n/logical-properties", () => {
  ruleTester.run("logical-properties", logicalProperties, {
    valid: [
      { name: "a logical utility", code: `const a = <div className="ms-4 text-start" />;` },
      {
        name: "a logical utility inside cn()",
        code: `const a = <div className={cn("ps-2", isOpen && "end-0")} />;`,
      },
      {
        name: "a direction-qualified transform",
        code: `const a = <div className="ltr:-translate-x-full rtl:translate-x-full" />;`,
      },
      {
        name: "an English word that is not a class",
        // The reason this rule reads class strings rather than the file. `left`
        // and `right` are ordinary words and ordinary key names.
        code: `
          if (event.key === "ArrowLeft") move(-1);
          const label = "the queue on the right";
          const pad = "pl-5 is a physical utility";
        `,
      },
      {
        name: "a physical side in a prop that is not a class",
        code: `const a = <Tooltip placement="left" data-side="right" />;`,
      },
      {
        name: "a physical side in a comment",
        code: `
          // ml-4 was replaced by ms-4 here
          const a = <div className="ms-4" />;
        `,
      },
    ],

    invalid: [
      {
        name: "a physical margin in a className literal",
        code: `const a = <div className="ml-4" />;`,
        errors: [{ messageId: "logicalTwin", data: { token: "ml-4", replacement: "ms-4" } }],
      },
      {
        name: "a physical side inside cn()",
        code: `const a = <div className={cn("flex", "text-right")} />;`,
        errors: 1,
      },
      {
        name: "a physical side in a ternary branch",
        code: `const a = <div className={cn(isOpen ? "left-0" : "right-0")} />;`,
        errors: 2,
      },
      {
        name: "a physical side in a template literal",
        code: "const a = <div className={`flex ${size} pl-4`} />;",
        errors: 1,
      },
      {
        name: "a physical side in a cn() outside JSX",
        // `listboxSkins.ts` builds class strings in plain functions, which is
        // why the builder selector exists as well as the attribute one.
        code: `export const skin = cn("rounded-l", "border-r");`,
        errors: 2,
      },
      {
        name: "a bare transform",
        code: `const a = <div className="-translate-x-full" />;`,
        errors: [{ messageId: "needsDirectionVariant" }],
      },
      {
        name: "each token in a list",
        code: `const a = <div className="ml-4 pr-2 flex" />;`,
        errors: 2,
      },
    ],
  });

  it("reports a token inside a className={cn(...)} exactly once", () => {
    // Both selectors reach that literal — the attribute's and the builder's —
    // and two reports for one token reads as two mistakes.
    const linter = new Linter();
    const messages = linter.verify(`const a = <div className={cn("ml-4")} />;`, {
      plugins: { i18n: i18nPlugin },
      rules: { "i18n/logical-properties": "error" },
      languageOptions: {
        parser: tseslint.parser as unknown as Linter.Parser,
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
    });
    expect(messages).toHaveLength(1);
  });

  it("is exported under the name the config registers", () => {
    expect(Object.keys(i18nPlugin.rules)).toEqual(["logical-properties"]);
  });
});
