import type { Rule } from "eslint";

/**
 * The rule that makes the right-to-left layout pass hold.
 *
 * `docs/i18n.md` is the prose; this file is the enforcement. Setting
 * `<html dir="rtl">` mirrors every *logical* CSS property in the application
 * and nothing else, so one `margin-left` left behind is a gap in the mirror —
 * and it is a gap with no failing test, no type error and no visual symptom in
 * the language the author was looking at. The only way to keep a mirrored layout
 * correct is to make the physical spelling unavailable.
 *
 * ## Why a lint rule and not a stylesheet scan
 *
 * The physical sides in this codebase are Tailwind utilities in `className`
 * strings, not declarations in a `.css` file. A scan of the built stylesheet
 * would find them — Tailwind only emits what is used — but it would find them
 * after a build, as `margin-left: 1rem` in a minified file, with nothing to
 * point at. A lint rule reports the token, in the file, on the line, in the
 * pull request that introduced it, and it can be silenced *with a reason* on the
 * rare occasion the physical side is the correct answer.
 *
 * ## The two kinds of finding
 *
 * **A utility with a logical twin** is always wrong: `ml-4` has `ms-4`, and
 * there is no argument for the former. The message names the replacement.
 *
 * **A utility with no logical twin** — `translate-x-*` is the whole list —
 * cannot be replaced, only qualified. A drawer that slides off the inline-start
 * edge has to travel the other way in a mirrored document, and the only way to
 * say that in Tailwind is a pair of direction variants
 * (`ltr:-translate-x-full rtl:translate-x-full`). So those are reported unless
 * the token carries an `ltr:` or `rtl:` variant, which is the author stating
 * which direction they meant.
 *
 * ## What it reads
 *
 * Class strings, and only class strings: the literals inside a `className`
 * attribute and inside a `cn()` / `clsx()` / `twMerge()` call. That matters
 * because "left" and "right" are ordinary English words and ordinary key names
 * — `ArrowLeft`, "the queue on the right" — and a rule that grepped the file
 * would report a dozen of those for every real finding, which is the failure
 * mode that gets a rule switched off. Comments are not literals, so prose about
 * `ml-4` is not a finding either.
 */

/** Physical utility prefix → the logical utility that replaces it. */
const REPLACEMENTS: readonly (readonly [prefix: string, replacement: string])[] = [
  // Longest first: `scroll-ml` has to be tested before `ml`, and `border-l`
  // before nothing else matches it. The lookup below is an ordered scan for
  // exactly this reason.
  ["scroll-ml", "scroll-ms"],
  ["scroll-mr", "scroll-me"],
  ["scroll-pl", "scroll-ps"],
  ["scroll-pr", "scroll-pe"],
  ["rounded-tl", "rounded-ss"],
  ["rounded-tr", "rounded-se"],
  ["rounded-bl", "rounded-es"],
  ["rounded-br", "rounded-ee"],
  ["rounded-l", "rounded-s"],
  ["rounded-r", "rounded-e"],
  ["border-l", "border-s"],
  ["border-r", "border-e"],
  ["ml", "ms"],
  ["mr", "me"],
  ["pl", "ps"],
  ["pr", "pe"],
  ["left", "start"],
  ["right", "end"],
];

/**
 * Complete utilities — no value suffix — with a logical twin.
 *
 * `border-r` and `rounded-l` are here as well as in the prefix table above,
 * because Tailwind spells both a valued and a valueless form of each:
 * `border-r-2` takes a width and `border-r` means the default one. The prefix
 * scan requires a `-` and a value, deliberately (so that `press-start` is not
 * read as the `pr` family), which leaves the bare forms to be listed.
 */
const EXACT_REPLACEMENTS: ReadonlyMap<string, string> = new Map([
  ["text-left", "text-start"],
  ["text-right", "text-end"],
  ["float-left", "float-start"],
  ["float-right", "float-end"],
  ["clear-left", "clear-start"],
  ["clear-right", "clear-end"],
  ["border-l", "border-s"],
  ["border-r", "border-e"],
  ["rounded-l", "rounded-s"],
  ["rounded-r", "rounded-e"],
  ["rounded-tl", "rounded-ss"],
  ["rounded-tr", "rounded-se"],
  ["rounded-bl", "rounded-es"],
  ["rounded-br", "rounded-ee"],
]);

/**
 * Utilities with no logical form, which must instead say which direction they
 * are for.
 *
 * `translate-x-0` is deliberately not here: zero displacement is the same
 * displacement in both directions, and `md:translate-x-0` is how a drawer says
 * "on a desktop, in flow". Flagging it would force a meaningless `ltr:`/`rtl:`
 * pair on the one value that cannot be wrong.
 */
const DIRECTION_QUALIFIED_ONLY: readonly string[] = ["translate-x"];

const DIRECTION_VARIANTS = new Set(["ltr", "rtl"]);

export interface ClassFinding {
  readonly token: string;
  readonly messageId: "logicalTwin" | "needsDirectionVariant";
  readonly replacement: string;
}

/**
 * Splits a Tailwind token into the parts this rule reasons about.
 *
 * `md:hover:-ml-4!` is a variant list, a negation, a utility and an importance
 * marker, and only the utility is being judged. Everything else has to be put
 * back when the message suggests a replacement, or the suggestion is one the
 * author cannot paste.
 */
export function splitToken(token: string): {
  readonly variants: readonly string[];
  readonly negated: boolean;
  readonly utility: string;
  readonly important: boolean;
} {
  /*
   * Split on the last colon, not the first, and not on every colon: an
   * arbitrary variant can contain one — `[&:has(:checked)]:ml-4` — and a split
   * that treated those as variant boundaries would mistake `has(` for a
   * variant and `checked)]` for the utility. Everything up to the final colon
   * is variants as far as this rule cares; the only question it asks of them is
   * whether `ltr` or `rtl` is among them.
   */
  const lastColon = token.lastIndexOf(":");
  const variantPart = lastColon === -1 ? "" : token.slice(0, lastColon);
  let utility = lastColon === -1 ? token : token.slice(lastColon + 1);

  const variants = variantPart === "" ? [] : variantPart.split(":");

  const important = utility.endsWith("!");
  if (important) utility = utility.slice(0, -1);

  const negated = utility.startsWith("-");
  if (negated) utility = utility.slice(1);

  return { variants, negated, utility, important };
}

/**
 * Judges one whitespace-separated class token.
 *
 * `null` means "nothing to say about this", which is the answer for the
 * overwhelming majority of tokens and for anything that is not recognisably a
 * physical utility.
 */
export function inspectToken(token: string): ClassFinding | null {
  if (token === "") return null;

  const { variants, negated, utility, important } = splitToken(token);
  const restore = (replacementUtility: string): string => {
    const prefix = variants.length === 0 ? "" : `${variants.join(":")}:`;
    return `${prefix}${negated ? "-" : ""}${replacementUtility}${important ? "!" : ""}`;
  };

  const exact = EXACT_REPLACEMENTS.get(utility);
  if (exact !== undefined) {
    return { token, messageId: "logicalTwin", replacement: restore(exact) };
  }

  for (const [prefix, replacement] of REPLACEMENTS) {
    // A value is required: `pr` on its own is not a utility, and `press-start`
    // must not be read as the `pr` family. Matching `prefix-` is what draws
    // that line, and it is also what keeps `ms-4` — already logical — out.
    if (!utility.startsWith(`${prefix}-`)) continue;
    const value = utility.slice(prefix.length);
    return { token, messageId: "logicalTwin", replacement: restore(`${replacement}${value}`) };
  }

  for (const prefix of DIRECTION_QUALIFIED_ONLY) {
    if (!utility.startsWith(`${prefix}-`)) continue;
    const value = utility.slice(prefix.length + 1);
    // Zero is direction-neutral. See `DIRECTION_QUALIFIED_ONLY`.
    if (value === "0") return null;
    if (variants.some((variant) => DIRECTION_VARIANTS.has(variant))) return null;
    return { token, messageId: "needsDirectionVariant", replacement: `ltr:${token} rtl:…` };
  }

  return null;
}

/** Every finding in a class string. */
export function inspectClassString(value: string): readonly ClassFinding[] {
  return value.split(/\s+/).flatMap((token) => {
    const finding = inspectToken(token);
    return finding === null ? [] : [finding];
  });
}

/** Call expressions whose string arguments are class lists. */
const CLASS_BUILDERS = new Set(["cn", "clsx", "classNames", "twMerge", "twJoin"]);

interface AstNode {
  readonly type: string;
  readonly [key: string]: unknown;
}

function isAstNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && typeof (value as AstNode).type === "string";
}

/**
 * Every string literal and template chunk anywhere beneath `node`.
 *
 * A hand-written walk rather than a second ESLint selector, because the shapes a
 * class value arrives in are open-ended — a ternary, a `&&`, an array, a `cn()`
 * inside a `cn()`, a template literal with three interpolations — and
 * enumerating them is a list that is wrong as soon as somebody writes a fourth
 * one. Descending into everything is the version that cannot be incomplete.
 *
 * Interpolated expressions are not followed *as strings*: a `${isActive ?
 * "ml-4" : ""}` is visited because the literals inside it are literals, but the
 * template's own joins are not reconstructed. Reconstructing them would mean
 * evaluating the expression, and a token split across an interpolation boundary
 * (`m${side}-4`) is not a token this rule can judge in any case.
 */
function collectStrings(node: unknown, found: { node: AstNode; value: string }[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, found);
    return;
  }
  if (!isAstNode(node)) return;

  if (node.type === "Literal" && typeof node.value === "string") {
    found.push({ node, value: node.value });
    return;
  }
  if (node.type === "TemplateElement") {
    const cooked = (node.value as { cooked?: unknown } | undefined)?.cooked;
    if (typeof cooked === "string") found.push({ node, value: cooked });
    return;
  }

  for (const [key, child] of Object.entries(node)) {
    // `parent` is a back-reference ESLint adds during traversal; following it
    // walks the whole program, repeatedly.
    if (key === "parent" || key === "loc" || key === "range") continue;
    collectStrings(child, found);
  }
}

export const logicalProperties: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require direction-agnostic Tailwind utilities so the layout mirrors under `dir=rtl`",
      url: "https://github.com/Kojo-Brown/boilerplate-react-ts/blob/main/docs/i18n.md",
    },
    schema: [],
    messages: {
      logicalTwin:
        '`{{token}}` names a physical side, so it does not mirror under `dir="rtl"`. Use `{{replacement}}`.',
      needsDirectionVariant:
        "`{{token}}` has no logical equivalent, so it must say which direction it is for: `{{replacement}}`. A bare transform moves the element the same way in a mirrored document, which is the wrong way in one of them.",
    },
  },

  create(context) {
    /*
     * One report per literal, however many visitors reach it.
     *
     * The two selectors below overlap by design — `className={cn("ml-4")}` is
     * both a class attribute and a builder call, and `cn()` is also used outside
     * JSX entirely (`listboxSkins.ts`) so neither selector can be dropped. Both
     * would otherwise report the same token twice, which reads as two mistakes
     * and doubles the count in a summary.
     */
    const reported = new Set<AstNode>();

    function reportIn(container: unknown): void {
      const strings: { node: AstNode; value: string }[] = [];
      collectStrings(container, strings);

      for (const { node, value } of strings) {
        if (reported.has(node)) continue;
        reported.add(node);
        for (const finding of inspectClassString(value)) {
          context.report({
            node: node as unknown as Rule.Node,
            messageId: finding.messageId,
            data: { token: finding.token, replacement: finding.replacement },
          });
        }
      }
    }

    return {
      JSXAttribute(node: Rule.Node) {
        const attribute = node as unknown as {
          name?: { type?: string; name?: unknown };
          value?: unknown;
        };
        const name = attribute.name?.name;
        if (name !== "className" && name !== "class") return;
        if (attribute.value === undefined || attribute.value === null) return;
        reportIn(attribute.value);
      },

      CallExpression(node) {
        const { callee } = node;
        const name =
          callee.type === "Identifier"
            ? callee.name
            : callee.type === "MemberExpression" && callee.property.type === "Identifier"
              ? callee.property.name
              : null;
        if (name === null || !CLASS_BUILDERS.has(name)) return;
        reportIn(node.arguments);
      },
    };
  },
};

export const i18nPlugin = {
  rules: { "logical-properties": logicalProperties },
};
