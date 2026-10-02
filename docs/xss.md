# XSS-safe rendering

React escapes every string it interpolates. `<p>{bio}</p>` cannot execute
script, whatever `bio` contains, and that single property removes the entire
class of accidental cross-site scripting from a React application. What is left
is deliberate XSS: code that reached for an API whose whole purpose is to parse
a string as markup.

So the policy is not "be careful with user input". It is:

1. **Nothing may parse HTML**, enforced by the `security/no-dangerous-html`
   lint rule.
2. **One component may**, named in that rule's `allow` list, and it accepts only
   a string the sanitiser produced.

Each half is useless alone. A sanitiser nobody is obliged to call is a utility
module; a ban with no sanctioned route out of it gets a disable comment the
first time somebody has to render a CMS field.

## The three pieces

|                                     |                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `src/shared/lib/sanitizeHtml.ts`    | The policy: DOMPurify configured with an allowlist, and the `SafeHtml` type. |
| `src/shared/ui/RichText.tsx`        | The only sanctioned sink. Takes `SafeHtml`, nothing else.                    |
| `tooling/eslint/noDangerousHtml.ts` | The ban. Reports every HTML-parsing sink outside the allow list.             |

Using it looks like this, and there is no shorter spelling:

```tsx
import { sanitizeHtml } from "@/shared/lib/sanitizeHtml";
import { RichText } from "@/shared/ui/RichText";

export function ArticleBody({ body }: { body: string }) {
  return <RichText html={sanitizeHtml(body)} className="max-w-prose" />;
}
```

If the value is not meant to contain markup, do not reach for any of this —
`<p>{body}</p>` is the correct answer and is already safe.

## What the policy allows

An allowlist, because a denylist has to be complete and the set of elements that
can run script grows with the platform. The lists live in `sanitizeHtml.ts` as
`ALLOWED_TAGS` and `ALLOWED_ATTR` and are exported so this document and the
tests describe the policy rather than a copy of it.

**Tags**: paragraphs, line breaks, rules, emphasis (`strong`, `b`, `em`, `i`,
`u`, `s`, `small`, `sub`, `sup`), `code`/`pre`/`kbd`, quotations
(`blockquote`, `cite`, `q`), lists (`ul`, `ol`, `li`, `dl`, `dt`, `dd`), `span`,
`a`, and `h2`–`h6`.

**Attributes**: `href`, `title`, `lang`, `dir`. That is the whole list.

Four absences are decisions, not oversights:

- **No `class`, `style` or `id`.** `style` is an injection surface in its own
  right; `id` lets authored content collide with the application's own anchors
  and `aria-labelledby` wiring; `class` lets it borrow the design system's
  utilities to impersonate application chrome. The consequence is that content
  cannot style itself, so `RichText` carries the typography — which is also why
  its wrapper classes and the attribute list are tested together.
- **No `target`.** Not a script vector once `href` is checked, but
  `target="_blank"` without `rel="noopener"` hands the opened document a
  `window.opener` handle, and the only way to guarantee the `rel` is a DOMPurify
  hook, which is global mutable state on the instance. Links open in the same
  tab.
- **No ARIA, no `data-*`.** Prose has no accessibility tree to describe and no
  component state to carry. `aria-label` on a link is a way to make a link
  announce something other than what it says.
- **XHTML namespace only.** SVG and MathML are excluded, which is where
  mutation-XSS lives: the parser's foreign-content rules differ from HTML's, so
  a byte sequence can sanitise clean as MathML and re-parse as an
  `<img onerror>` once assigned to `innerHTML`. `sanitizeHtml.test.ts` pins one
  of those payloads.

`href` is narrowed to `http`, `https`, `mailto` and relative URLs. DOMPurify's
default list also permits `ftp`, `ftps`, `tel`, `callto`, `sms`, `cid` and
`xmpp`; each hands a string to an external handler and none appears in this
application's content. The pattern keeps the shape of DOMPurify's own — the
awkward-looking `[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$)` alternation is what admits
`/docs/intro`, `#anchor` and `?q=1` while still rejecting `javascript:`,
including when it is spelled `JaVaScRiPt:`, padded with spaces, or split across
a newline.

## `SafeHtml`

`sanitizeHtml()` returns `SafeHtml`, a branded `string` nothing else constructs,
and `RichText` accepts nothing else. That makes the realistic mistake a compile
error rather than a review comment — not "somebody renders raw input on
purpose", but sanitising a template and then interpolating a value into it, or
sanitising at the wrong end of a pipeline.

The brand is a `unique symbol` in a `declare const`, so it exists only in the
type system: at runtime `SafeHtml` is an ordinary string with no forgeable
marker property. It is **not** a security boundary — `value as SafeHtml`
defeats it in one line — and it is not meant to be. The lint rule is the
boundary. The brand is there so the honest mistake fails to compile.

## Failing closed

DOMPurify needs a DOM to parse with. Where there is none — a build-time script,
a prerender, a `@vitest-environment node` test — `sanitizeHtml()` returns its
input **escaped**, not its input.

The alternative is worse than it looks. Returning the string unchanged because
sanitisation was unavailable produces a build that is correct in every browser
and ships raw markup in the one environment where the check silently did not
run. Escaped output is visibly wrong — a reader sees `<p>` as text — and cannot
execute. `sanitizeHtml.node.test.ts` is that case, run in a real Node
environment rather than simulated.

## The ban

`security/no-dangerous-html` reports six sinks. A ban on
`dangerouslySetInnerHTML` alone would be theatre: `ref.current` is a real
element, so the alternatives have to close at the same time or the rule just
moves which line the payload is written on.

| Sink                                         | Why it is on the list                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `dangerouslySetInnerHTML` as a JSX attribute | The React sink.                                                                                                                      |
| `dangerouslySetInnerHTML` as an object key   | `createElement("div", props)` and `{...props}` pass the same prop without JSX.                                                       |
| `innerHTML` / `outerHTML` assignment         | The direct equivalent. `+=` and `el["innerHTML"]` included.                                                                          |
| `insertAdjacentHTML`                         | `innerHTML` that appends.                                                                                                            |
| `Range.createContextualFragment`             | The documented way to parse a string into nodes without `innerHTML`, and so the first search result once `innerHTML` is unavailable. |
| `document.write` / `document.writeln`        | Parse into the open document.                                                                                                        |

APIs that cannot parse markup — `textContent`, `createElement`,
`Element.append` — are not reported. The rule is about parsing, not about
touching the DOM.

`write` and `writeln` are reported only when the receiver is recognisably a
document (`document`, `doc`, `window.document`, `frame.contentDocument`,
`node.ownerDocument`). A rule that reported every `.write()` would hit streams,
responses, loggers and the clipboard, and a rule like that gets switched off —
which is the only outcome worse than not having one.

### What it cannot see, honestly

- **A computed property name.** `el[key] = value` where `key` is a variable is
  unknowable to a lint rule, and reporting every computed access would make the
  rule unusable. A computed _string literal_ is reported.
- **A document under an unrecognised name.** `write` cannot be judged on the
  method name, so it is judged on the receiver's: `document`, `doc`,
  `window.document`, `frame.contentDocument`, `node.ownerDocument`, and those
  behind a `!`, an `as` cast or an optional chain. A document held as
  `target` escapes it. The alternative is reporting every `.write()` in the
  codebase.
- **`DOMParser.parseFromString`.** It produces an inert document — scripts do
  not run — but adopting those nodes into the live document does fire
  `onerror`. It is not reported because `DOMParser` is also the ordinary way to
  read XML, and the false-positive rate is what decides whether a rule survives.
  Pass anything you adopt through `sanitizeHtml()` first.
- **A cast.** `value as SafeHtml` type-checks. See above: the brand catches
  mistakes, the rule catches intent, and neither catches somebody determined to
  write the bug.
- **`eval`, `setTimeout("string")`, dynamic `import()`.** Script injection
  rather than HTML injection, and a different control. The CSP item in
  `SPEC.md` covers them.

### Earning an entry in `allow`

The list lives in `eslint.config.ts` as `HTML_SANITISATION_BOUNDARY`, not in a
disable comment, and the difference is who can grant the exemption. A
`// eslint-disable-next-line` is available to anyone editing any file and a
reviewer has to spot one line in a diff that is mostly about something else.
Widening the allow list is a change to the lint configuration, in a file whose
entire contents are rules.

A file belongs there only if it sanitises everything it renders and accepts
`SafeHtml` at its boundary. Adding one because the rule is in the way is how the
ban becomes paperwork. `RichText.tsx` is the only entry, and it carries no
disable comment of its own — so moving or renaming it fails the lint run rather
than carrying its permission along with it.

### Tests

The rule is off for `*.test.{ts,tsx}` and `src/test/**`. A test that builds a
DOM fixture from a string it wrote itself — `focusTrap.test.ts` — is not an
injection: there is no untrusted input in a unit test, and nothing in a `.test.`
file is in the shipped module graph, which `fsd/layer-imports` enforces
separately. The ban is scoped to the code that can receive data.

## What this does not cover

This is one layer. It stops markup in a string from becoming markup in the
document, and nothing else:

- **Script injection** — `eval`, `new Function`, a string passed to
  `setTimeout`. Different sink, different control.
- **Anything the server renders.** `index.html` is a static template here, but a
  template that interpolated anything would need its own escaping; a sanitiser
  in the browser cannot help a document that arrived already compromised.
- **Inline script of the application's own**, which is what CSP is for. The
  next item in `SPEC.md` wires nonces through the Vite build; a strict CSP is
  the control that holds when this one is bypassed, and this one is what keeps
  the CSP from being the only thing standing.
- **Where the untrusted string came from.** A sanitiser renders a malicious
  string harmlessly; it does not tell you a user could set it. That is still a
  question to ask at the boundary where the data enters.
