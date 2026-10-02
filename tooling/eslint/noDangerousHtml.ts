import type { Rule } from "eslint";

/**
 * The ban that makes the sanitisation policy enforceable.
 *
 * `docs/xss.md` is the prose; this file is the enforcement. React escapes every
 * interpolated string, which means this application has no accidental XSS — it
 * can only have deliberate XSS, written by someone who reached for a sink that
 * parses HTML. There are six of those on the platform, and this rule reports
 * every one of them outside the files named in `allow`.
 *
 * ## Why a lint rule and not a code review
 *
 * `dangerouslySetInnerHTML` is self-documenting in a way that argues against
 * needing a rule: nobody writes it by accident. But "nobody writes it by
 * accident" is not the failure mode. The failure mode is a component that
 * renders a server-provided string which was safe when the component was
 * written, three releases before the field became user-editable. Nothing about
 * that change touches the component, so there is no diff for a reviewer to
 * read, and the type system has nothing to say — it is `string` either way.
 * A ban on the sink is what makes the question get asked once, at the sink,
 * rather than at every call site forever.
 *
 * ## The sinks, and why each is on the list
 *
 * A ban on `dangerouslySetInnerHTML` alone would be theatre. The DOM is
 * reachable from any component — `ref.current` is a real element — so the
 * alternatives have to be closed at the same time or the rule just changes
 * which line the payload is written on:
 *
 * - **`innerHTML` / `outerHTML`** assignment, including `+=`, including
 *   `el["innerHTML"]`. The direct equivalent.
 * - **`insertAdjacentHTML`**, which is `innerHTML` that appends.
 * - **`Range.createContextualFragment`**, which is the documented way to parse
 *   a string into nodes without assigning to `innerHTML`, and therefore the
 *   first thing a search turns up when `innerHTML` is unavailable.
 * - **`document.write` / `document.writeln`**, which parse into the open
 *   document.
 * - **A `dangerouslySetInnerHTML` key in an object literal**, because
 *   `createElement("div", props)` and `{...props}` are JSX-free ways to pass
 *   the same prop, and a rule that only read JSX attributes would miss them.
 *
 * Not on the list: `document.createElement` + `textContent`, `Element.append`,
 * and every other API that cannot parse markup. The rule is about parsing, not
 * about touching the DOM.
 *
 * ## `write` is only `document.write`
 *
 * The call checks below match on the method name, which is specific enough for
 * `insertAdjacentHTML` and nowhere near specific enough for `write`: a stream,
 * a response, a logger and a clipboard all have one. So `write` and `writeln`
 * are reported only when the receiver is recognisably a document
 * (`document.write`, `window.document.write`, `iframe.contentDocument.write`).
 * A rule that reported every `.write()` would be switched off within a week,
 * which is the only outcome worse than not having it.
 */

/** Properties whose assignment parses the right-hand side as HTML. */
export const ASSIGNMENT_SINKS = new Set(["innerHTML", "outerHTML"]);

/** Methods that parse a string argument as HTML, on any receiver. */
export const CALL_SINKS = new Set(["insertAdjacentHTML", "createContextualFragment"]);

/** Methods that parse as HTML, but only on a document receiver. See above. */
export const DOCUMENT_CALL_SINKS = new Set(["write", "writeln"]);

/** The React prop that renders a string as markup. */
export const DANGEROUS_PROP = "dangerouslySetInnerHTML";

interface Options {
  /**
   * Files exempt from the ban, as path suffixes (`"shared/ui/RichText.tsx"`).
   *
   * Suffixes rather than globs or absolute paths, because the same rule has to
   * recognise the same file under ESLint (an absolute path), under `RuleTester`
   * (a bare `file.tsx`) and on Windows (backslashes). A suffix match on `/`
   * boundaries is the comparison that behaves identically in all three.
   */
  readonly allow: readonly string[];
}

/** Whether `filename` is one of the exempt files. */
export function isAllowedFile(filename: string, allow: readonly string[]): boolean {
  const normalised = filename.replace(/\\/g, "/");
  return allow.some((entry) => {
    const suffix = entry.replace(/\\/g, "/").replace(/^\.?\//, "");
    // The `/` boundary is what stops `RichText.tsx` from exempting
    // `EvilRichText.tsx`, which is otherwise a one-character bypass.
    return normalised === suffix || normalised.endsWith(`/${suffix}`);
  });
}

/**
 * The static name of a member access, or `null` when there is not one.
 *
 * `el.innerHTML` and `el["innerHTML"]` are the same access written two ways and
 * both are reported; `el[name]` is not, because the rule cannot know what
 * `name` holds. That is a real gap and a deliberate one — the alternative is
 * reporting every computed property access in the codebase — and it is the gap
 * the `SafeHtml` type and code review cover rather than this rule.
 */
export function staticMemberName(node: {
  computed?: boolean;
  property?: { type?: string; name?: unknown; value?: unknown };
}): string | null {
  const property = node.property;
  if (property === undefined) return null;
  if (node.computed === true) {
    return property.type === "Literal" && typeof property.value === "string"
      ? property.value
      : null;
  }
  return property.type === "Identifier" && typeof property.name === "string" ? property.name : null;
}

interface ExpressionLike {
  readonly type: string;
  readonly name?: unknown;
  readonly property?: { type?: string; name?: unknown; value?: unknown };
  readonly computed?: boolean;
}

/**
 * Strips the wrappers that sit between a call and the expression it is on.
 *
 * `frame.contentDocument!.write(s)` is the case that caught this out: the `!`
 * is a `TSNonNullExpression` node, so the receiver of `.write` is not the member
 * expression it appears to be, and a receiver check that did not unwrap it saw
 * an unrecognised node and stayed quiet. `as` casts, parentheses and optional
 * chains are the same shape of mistake, and all four are *more* likely in code
 * reaching for a nullable `contentDocument` than in code that is not.
 */
export function unwrapExpression(node: unknown): unknown {
  let current = node;
  for (;;) {
    if (typeof current !== "object" || current === null) return current;
    const { type, expression } = current as { type?: string; expression?: unknown };
    if (
      type === "TSNonNullExpression" ||
      type === "TSAsExpression" ||
      type === "TSSatisfiesExpression" ||
      type === "TSTypeAssertion" ||
      type === "ChainExpression"
    ) {
      current = expression;
      continue;
    }
    return current;
  }
}

/**
 * Whether `node` is an expression that plainly evaluates to a document.
 *
 * Name-based, because that is all a lint rule has: `document`,
 * `window.document`, `frame.contentDocument`, `doc` — the last of these is
 * included because `const doc = iframe.contentDocument` is how the real code
 * reaches a second document, and a rule that insisted on the literal word
 * `document` would miss it.
 */
export function isDocumentReceiver(node: unknown): boolean {
  const unwrapped = unwrapExpression(node);
  if (typeof unwrapped !== "object" || unwrapped === null) return false;
  const expression = unwrapped as ExpressionLike;
  if (expression.type === "Identifier") {
    return expression.name === "document" || expression.name === "doc";
  }
  if (expression.type === "MemberExpression") {
    const name = staticMemberName(expression);
    return name === "document" || name === "contentDocument" || name === "ownerDocument";
  }
  return false;
}

/** The name an object-literal key spells, or `null` for a computed one. */
export function staticKeyName(property: {
  computed?: boolean;
  key?: { type?: string; name?: unknown; value?: unknown };
}): string | null {
  if (property.computed === true) return null;
  const key = property.key;
  if (key === undefined) return null;
  if (key.type === "Identifier" && typeof key.name === "string") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

function readOptions(raw: unknown): Options {
  if (typeof raw !== "object" || raw === null) return { allow: [] };
  const allow = (raw as { allow?: unknown }).allow;
  if (!Array.isArray(allow)) return { allow: [] };
  return { allow: allow.filter((entry): entry is string => typeof entry === "string") };
}

export const noDangerousHtml: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban every DOM sink that parses a string as HTML, outside the files allowed to sanitise",
      url: "https://github.com/Kojo-Brown/boilerplate-react-ts/blob/main/docs/xss.md",
    },
    schema: [
      {
        type: "object",
        properties: {
          allow: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      dangerousProp:
        "`dangerouslySetInnerHTML` renders a string as markup, which is the one thing React's escaping does not cover. Pass the value as a child to render it as text, or sanitise it with `sanitizeHtml()` from `@/shared/lib/sanitizeHtml` and render it through `<RichText>`. If this really is a new sanitisation boundary, add the file to the rule's `allow` list in `eslint.config.ts` and say why in the pull request.",
      htmlSink:
        "`{{sink}}` parses its argument as HTML, so any `<img onerror>` in it runs. Use `textContent` to insert text, or sanitise with `sanitizeHtml()` and render through `<RichText>`. See docs/xss.md.",
    },
  },

  create(context) {
    const { allow } = readOptions(context.options[0]);
    // `physicalFilename` is the file on disk; `filename` can be a virtual path
    // for a processed block (a code fence in Markdown). The exemption is about a
    // real file, so it reads the real one, falling back for `RuleTester`.
    const filename = context.physicalFilename || context.filename;
    if (isAllowedFile(filename, allow)) return {};

    function reportSink(node: Rule.Node, sink: string): void {
      context.report({ node, messageId: "htmlSink", data: { sink } });
    }

    return {
      JSXAttribute(node: Rule.Node) {
        const attribute = node as unknown as { name?: { type?: string; name?: unknown } };
        if (attribute.name?.name !== DANGEROUS_PROP) return;
        context.report({ node, messageId: "dangerousProp" });
      },

      Property(node) {
        if (staticKeyName(node) !== DANGEROUS_PROP) return;
        context.report({ node, messageId: "dangerousProp" });
      },

      AssignmentExpression(node) {
        const { left } = node;
        if (left.type !== "MemberExpression") return;
        const name = staticMemberName(left);
        if (name === null || !ASSIGNMENT_SINKS.has(name)) return;
        reportSink(node, name);
      },

      CallExpression(node) {
        const { callee } = node;
        if (callee.type !== "MemberExpression") return;
        const name = staticMemberName(callee);
        if (name === null) return;
        if (CALL_SINKS.has(name)) {
          reportSink(node, name);
          return;
        }
        if (DOCUMENT_CALL_SINKS.has(name) && isDocumentReceiver(callee.object)) {
          reportSink(node, `document.${name}`);
        }
      },
    };
  },
};

export const securityPlugin = {
  rules: { "no-dangerous-html": noDangerousHtml },
};
