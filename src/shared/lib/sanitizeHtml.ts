import createDOMPurify, { type Config, type DOMPurify } from "dompurify";

/**
 * The application's single HTML sanitisation policy.
 *
 * `docs/xss.md` is the prose; this file is the policy. React escapes every
 * interpolated string, so the only way HTML reaches the DOM in this codebase is
 * through a sink that was asked for explicitly — `dangerouslySetInnerHTML`,
 * `innerHTML`, `insertAdjacentHTML` — and the `security/no-dangerous-html` lint
 * rule makes every one of those unavailable outside `RichText.tsx`. That rule
 * and this module are two halves of one guarantee: the rule says *nothing else
 * may parse HTML*, and this module is what the one exception is allowed to
 * parse. Either half alone is decoration.
 *
 * ## Why a branded type
 *
 * {@link sanitizeHtml} returns {@link SafeHtml}, a `string` the rest of the
 * program cannot construct, and `RichText` accepts nothing else. That turns the
 * ordering mistake — sanitising and then concatenating, or sanitising the
 * template but not the value interpolated into it — into a type error rather
 * than a review comment. A brand is not a security boundary (a cast defeats it)
 * and is not meant to be one; the lint rule is the boundary. The brand is there
 * so that the common, honest mistake fails to compile.
 *
 * ## Why an allowlist, and this allowlist
 *
 * Every entry below is a tag or attribute some piece of prose actually needs.
 * A denylist is the wrong shape for this problem — it has to be complete, and
 * the list of elements that can run script grows with the platform — so the
 * policy names what is permitted and everything else is dropped. In
 * particular, and deliberately:
 *
 * - **No `class`, `style` or `id`.** `style` is an injection surface in its own
 *   right (`background: url(...)`, and historically `expression()`), `id` lets
 *   authored content collide with the application's own anchors and with
 *   `aria-labelledby` wiring, and `class` lets it borrow the design system's
 *   utilities to impersonate application chrome. Rich text is text, not layout.
 * - **No `target`.** It is not a script vector once `href` is schema-checked,
 *   but `target="_blank"` without `rel="noopener"` hands the opened document a
 *   `window.opener` handle, and the only way to guarantee the `rel` is a
 *   DOMPurify hook — global mutable state on the instance (see below). Links
 *   open in the same tab, which is also what a screen-reader user expects.
 * - **No ARIA and no `data-*`.** Authored prose has no accessibility tree to
 *   describe and no component state to carry. `aria-label` on a link is a way
 *   to make a link announce something other than what it says.
 * - **XHTML only.** `ALLOWED_NAMESPACES` excludes SVG and MathML, which is
 *   where the mutation-XSS payloads live: the parser's foreign-content rules
 *   differ from HTML's, so a byte sequence can sanitise clean as MathML and
 *   re-parse as an `<img onerror>` once it is assigned to `innerHTML`.
 */

/**
 * A string that has been through {@link sanitizeHtml}.
 *
 * The brand is a `unique symbol` in a `declare const`, so it exists only in the
 * type system: `SafeHtml` is a `string` at runtime, usable anywhere a string is,
 * and no object carries a marker property that could be forged or serialised.
 */
declare const sanitizedBrand: unique symbol;

export type SafeHtml = string & { readonly [sanitizedBrand]: "html" };

/**
 * Tags the policy permits.
 *
 * Block structure, inline emphasis, lists, code and links — the vocabulary of a
 * paragraph of prose from a CMS or a Markdown renderer. Headings start at `h2`
 * because `h1` belongs to the page, not to a fragment embedded in it, and an
 * authored `h1` breaks the document outline every route depends on.
 */
export const ALLOWED_TAGS = [
  "p",
  "br",
  "hr",
  "span",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "small",
  "sub",
  "sup",
  "code",
  "pre",
  "kbd",
  "blockquote",
  "cite",
  "q",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "a",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
] as const;

/**
 * Attributes the policy permits, on any permitted tag.
 *
 * `href` is the only one with a value DOMPurify has to judge rather than merely
 * carry; {@link ALLOWED_URI_REGEXP} is that judgement. `lang` and `dir` are here
 * because a quotation in another language is a WCAG 3.1.2 requirement and a
 * right-to-left quotation inside left-to-right prose cannot be expressed any
 * other way.
 */
export const ALLOWED_ATTR = ["href", "title", "lang", "dir"] as const;

/**
 * Schemes `href` may name — plus relative URLs, which is what the second and
 * third alternations are for.
 *
 * This is DOMPurify's own default pattern with its scheme list narrowed from
 * ten to two. Keeping its shape is deliberate: the alternation
 * `[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$)` is what admits `/docs/intro`, `#anchor`
 * and `?q=1` while still rejecting anything whose leading run of scheme
 * characters is followed by a colon, and rewriting that from scratch is how a
 * sanitiser acquires a bypass. What is removed is `ftp`, `ftps`, `tel`,
 * `callto`, `sms`, `cid` and `xmpp`: none of them appear in this application's
 * content, and each is an external handler the browser hands a string to.
 *
 * DOMPurify strips whitespace from the value before testing it, so
 * `java\nscript:` and `  javascript:` are both rejected rather than smuggled
 * past the `^` anchor.
 */
export const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;

/** The complete DOMPurify configuration. Nothing else sanitises in this app. */
export const SANITIZE_POLICY: Config = {
  ALLOWED_TAGS: [...ALLOWED_TAGS],
  ALLOWED_ATTR: [...ALLOWED_ATTR],
  ALLOWED_URI_REGEXP,
  ALLOWED_NAMESPACES: ["http://www.w3.org/1999/xhtml"],
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  // Self-closing syntax inside an attribute value was the jQuery 3.0 mXSS bug.
  // The default is already `false`; it is written out because a policy that
  // relies on a default is a policy that changes when the default does.
  ALLOW_SELF_CLOSE_IN_ATTR: false,
  // A disallowed *element* is removed and its text kept, so `<div>text</div>`
  // becomes `text` rather than nothing. Elements whose content is not text —
  // `script`, `style`, `template` — are in DOMPurify's `FORBID_CONTENTS` and
  // lose their children too, which is why a stripped `<script>` does not leave
  // `alert(1)` behind as a paragraph.
  KEEP_CONTENT: true,
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
};

const HTML_ESCAPES: ReadonlyMap<string, string> = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&#39;"],
]);

/**
 * Renders `value` as literal text inside an HTML context.
 *
 * Almost nothing should need this: JSX escapes `{value}` already, and a string
 * that is meant to be read as text should be passed to React as a child. It
 * exists for the one place a string has to be *spelled* as HTML — the
 * fail-closed branch of {@link sanitizeHtml} — and is exported because a
 * half-written escape function is a recurring way to reintroduce the bug.
 *
 * `&` is first in the map and the regexp is a single pass, so `&lt;` cannot be
 * produced and then re-escaped into `&amp;lt;`.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES.get(character) ?? character);
}

/**
 * The DOMPurify instance this policy owns, created on first use.
 *
 * Two things are deliberate. It is a **dedicated instance** rather than the
 * package's default export, because `addHook` mutates the instance it is called
 * on and the default export is a singleton shared with every other consumer in
 * the bundle — a dependency that registers a hook for its own purposes would
 * otherwise be registering it for this policy too. And it is **lazy**, because
 * the factory needs a `window`: constructing it at module scope would make this
 * module unimportable from a Node context (a test with
 * `@vitest-environment node`, a build-time script) that never calls it.
 */
let instance: DOMPurify | null = null;

function getPurifier(): DOMPurify | null {
  if (instance !== null) return instance;
  if (typeof window === "undefined") return null;
  instance = createDOMPurify(window);
  return instance;
}

/**
 * The only way HTML becomes renderable in this application.
 *
 * Removes every tag and attribute the policy above does not name, and returns
 * the result branded as {@link SafeHtml} so `RichText` will accept it.
 *
 * ## Fail closed
 *
 * When there is no DOM to parse with — no `window`, or a `window` whose
 * `DOMParser` and `<template>` DOMPurify cannot use — this returns the input
 * *escaped*, not the input. The alternative, returning the string unchanged
 * because sanitisation was unavailable, is the failure mode that matters: it
 * produces a build that works in every browser and ships raw markup in the one
 * environment where the check silently did not run. Escaped output is visibly
 * wrong (a reader sees `<p>` as text) and cannot execute, which is the correct
 * trade in that order.
 */
export function sanitizeHtml(dirty: string): SafeHtml {
  const purifier = getPurifier();
  if (purifier === null || !purifier.isSupported) {
    return escapeHtml(dirty) as SafeHtml;
  }
  return purifier.sanitize(dirty, SANITIZE_POLICY) as SafeHtml;
}
