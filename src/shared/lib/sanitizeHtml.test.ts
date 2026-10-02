import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ALLOWED_ATTR,
  ALLOWED_TAGS,
  ALLOWED_URI_REGEXP,
  SANITIZE_POLICY,
  escapeHtml,
  sanitizeHtml,
} from "@/shared/lib/sanitizeHtml";

/**
 * What these tests are for.
 *
 * Not "DOMPurify works" — Cure53 test that, and re-testing it here would be a
 * suite that passes whatever policy this module configures. What is tested is
 * *the policy*: the tag and attribute allowlist, the URI scheme narrowing, and
 * the fail-closed branch, each of which is a decision made in
 * `sanitizeHtml.ts` and each of which would silently stop holding if someone
 * edited the config object. The payload corpus below is there so that the
 * decisions are stated as outcomes a reader can check against a real attack,
 * rather than as a list of configuration keys.
 */

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("dompurify");
});

describe("escapeHtml", () => {
  it("escapes the five characters that change meaning in markup", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("does not double-escape, because `&` is replaced in the same pass", () => {
    // A two-pass implementation that handled `<` before `&` would turn this
    // into `&amp;lt;`, which renders as the text `&lt;` rather than `<`.
    expect(escapeHtml("<b>")).toBe("&lt;b&gt;");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves text with nothing to escape untouched", () => {
    expect(escapeHtml("plain text, 100% of it")).toBe("plain text, 100% of it");
  });
});

describe("sanitizeHtml — the allowlist", () => {
  it("keeps prose structure, emphasis and lists", () => {
    expect(sanitizeHtml("<p>hello <strong>world</strong></p>")).toBe(
      "<p>hello <strong>world</strong></p>",
    );
    expect(sanitizeHtml("<ul><li>a</li><li>b</li></ul>")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(sanitizeHtml("<blockquote><p>quoted</p></blockquote>")).toBe(
      "<blockquote><p>quoted</p></blockquote>",
    );
  });

  it("drops a disallowed element but keeps its text", () => {
    // `KEEP_CONTENT`. A `<div>` wrapper the policy does not permit must not
    // take the paragraph inside it along.
    expect(sanitizeHtml("<div><p>nested</p></div>")).toBe("<p>nested</p>");
  });

  it("drops the content of elements whose content is not text", () => {
    // The distinction that makes the previous assertion safe: a stripped
    // `<script>` must not leave its source behind as a text node.
    expect(sanitizeHtml("<script>alert(1)</script>")).toBe("");
    expect(sanitizeHtml("<style>body{display:none}</style>")).toBe("");
    expect(sanitizeHtml("<p>before</p><script>alert(1)</script><p>after</p>")).toBe(
      "<p>before</p><p>after</p>",
    );
  });

  it("keeps only the four permitted attributes", () => {
    expect(sanitizeHtml(`<a href="https://x.co" title="t" lang="en" dir="rtl">x</a>`)).toBe(
      `<a href="https://x.co" title="t" lang="en" dir="rtl">x</a>`,
    );
    // `class` would let content borrow the design system; `style` is an
    // injection surface; `id` collides with the application's own anchors.
    expect(sanitizeHtml(`<p class="sr-only" style="color:red" id="main">x</p>`)).toBe("<p>x</p>");
  });

  it("drops ARIA and data attributes", () => {
    expect(sanitizeHtml(`<p data-tracking="1" aria-label="something else">x</p>`)).toBe("<p>x</p>");
  });

  it("drops h1, so an embedded fragment cannot break the document outline", () => {
    expect(ALLOWED_TAGS).not.toContain("h1");
    expect(sanitizeHtml("<h1>Title</h1>")).toBe("Title");
    expect(sanitizeHtml("<h2>Section</h2>")).toBe("<h2>Section</h2>");
  });

  it("escapes text that was never markup", () => {
    expect(sanitizeHtml("plain text & <b>bold</b>")).toBe("plain text &amp; <b>bold</b>");
  });

  it("exports a policy built from the exported allowlists", () => {
    // The lists are exported so `docs/xss.md` and these tests describe the same
    // policy the sanitiser runs, rather than a copy of it that can drift.
    expect(SANITIZE_POLICY.ALLOWED_TAGS).toEqual([...ALLOWED_TAGS]);
    expect(SANITIZE_POLICY.ALLOWED_ATTR).toEqual([...ALLOWED_ATTR]);
    expect(SANITIZE_POLICY.ALLOWED_NAMESPACES).toEqual(["http://www.w3.org/1999/xhtml"]);
  });
});

describe("sanitizeHtml — the payload corpus", () => {
  /**
   * One case per class of attack, with the surviving output written out.
   *
   * `toBe` rather than a "does not contain `script`" assertion, deliberately:
   * a substring check passes for output that dropped the payload *and* for
   * output that mangled it into something else dangerous, and it is the second
   * one this corpus exists to catch.
   */
  const corpus: readonly (readonly [name: string, dirty: string, clean: string])[] = [
    ["inline script", "<script>alert(1)</script>", ""],
    ["event handler on a disallowed tag", `<img src=x onerror="alert(1)">`, ""],
    ["event handler on an allowed tag", `<p onclick="alert(1)">x</p>`, "<p>x</p>"],
    ["javascript: href", `<a href="javascript:alert(1)">click</a>`, "<a>click</a>"],
    ["javascript: href, mixed case", `<a href="JaVaScRiPt:alert(1)">click</a>`, "<a>click</a>"],
    ["javascript: href, leading whitespace", `<a href="  javascript:alert(1)">x</a>`, "<a>x</a>"],
    ["javascript: href, split by a newline", `<a href="java\nscript:alert(1)">x</a>`, "<a>x</a>"],
    ["data: href", `<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>`, "<a>x</a>"],
    ["iframe", `<iframe src="https://evil.example"></iframe>`, ""],
    ["form and input", `<form><input name="x"></form>`, ""],
    ["svg use", `<svg><use href="#x"/></svg>`, ""],
    [
      "svg animate, which rewrites an href after sanitisation",
      `<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>`,
      "",
    ],
    [
      // The namespace-confusion mXSS family: valid as MathML foreign content,
      // an `<img onerror>` once re-parsed as HTML. `ALLOWED_NAMESPACES` is why
      // this is empty rather than clever.
      "mXSS via MathML namespace confusion",
      `<math><mtext><table><mglyph><style><!--</style><img title="--><img src=1 onerror=alert(1)>">`,
      "",
    ],
    ["template element", "<template><p>t</p></template>", ""],
  ];

  it.each(corpus)("neutralises %s", (_name, dirty, clean) => {
    expect(sanitizeHtml(dirty)).toBe(clean);
  });

  it("leaves no executable attribute anywhere in the corpus output", () => {
    // A second, coarser net over the same corpus. The table above pins exact
    // output, which is precise but only covers what somebody thought to write
    // down; this asserts the invariant that actually matters.
    for (const [, dirty] of corpus) {
      const clean = sanitizeHtml(dirty);
      expect(clean).not.toMatch(/\son\w+\s*=/i);
      expect(clean.toLowerCase()).not.toContain("javascript:");
      expect(clean.toLowerCase()).not.toContain("<script");
    }
  });
});

describe("sanitizeHtml — URI schemes", () => {
  it("keeps http, https and mailto", () => {
    expect(sanitizeHtml(`<a href="https://x.co">x</a>`)).toBe(`<a href="https://x.co">x</a>`);
    expect(sanitizeHtml(`<a href="http://x.co">x</a>`)).toBe(`<a href="http://x.co">x</a>`);
    expect(sanitizeHtml(`<a href="mailto:someone@example.com">x</a>`)).toBe(
      `<a href="mailto:someone@example.com">x</a>`,
    );
  });

  it("keeps relative, fragment and query hrefs", () => {
    // The reason the pattern keeps DOMPurify's alternation instead of a bare
    // `^(?:https?|mailto):` — an authored link to another page of this app.
    expect(sanitizeHtml(`<a href="/docs/intro">x</a>`)).toBe(`<a href="/docs/intro">x</a>`);
    expect(sanitizeHtml(`<a href="#anchor">x</a>`)).toBe(`<a href="#anchor">x</a>`);
    expect(sanitizeHtml(`<a href="?q=1">x</a>`)).toBe(`<a href="?q=1">x</a>`);
    expect(sanitizeHtml(`<a href="sibling.html">x</a>`)).toBe(`<a href="sibling.html">x</a>`);
  });

  it("drops the external handlers DOMPurify allows by default", () => {
    // Each of these is in DOMPurify's default scheme list and not in ours.
    for (const href of ["tel:+15550100", "sms:+15550100", "ftp://x.co/f", "xmpp:a@b.co"]) {
      expect(sanitizeHtml(`<a href="${href}">x</a>`)).toBe("<a>x</a>");
    }
  });

  it("matches the scheme pattern directly, including the relative branch", () => {
    expect(ALLOWED_URI_REGEXP.test("https://x.co")).toBe(true);
    expect(ALLOWED_URI_REGEXP.test("mailto:a@b.co")).toBe(true);
    expect(ALLOWED_URI_REGEXP.test("/relative")).toBe(true);
    expect(ALLOWED_URI_REGEXP.test("relative.html")).toBe(true);
    expect(ALLOWED_URI_REGEXP.test("javascript:alert(1)")).toBe(false);
    expect(ALLOWED_URI_REGEXP.test("data:text/html,x")).toBe(false);
    expect(ALLOWED_URI_REGEXP.test("tel:123")).toBe(false);
  });

  it("drops target, so there is no opener to leak and no rel to forget", () => {
    expect(sanitizeHtml(`<a href="https://x.co" target="_blank">x</a>`)).toBe(
      `<a href="https://x.co">x</a>`,
    );
  });
});

describe("sanitizeHtml — fail closed", () => {
  it("escapes rather than passes through when DOMPurify cannot run", async () => {
    /*
     * The branch that decides what a misconfigured or unsupported environment
     * ships. `isSupported` is false in any context without a usable
     * `DOMParser`/`<template>`, and the tempting implementation — return the
     * input because there was nothing to check it with — is the one that serves
     * raw markup exactly where the check did not happen.
     *
     * `doMock` rather than `mock` because the stub has to be installed around a
     * fresh module instance: `sanitizeHtml.ts` memoises its DOMPurify instance,
     * so the module registry has to be reset for the stub to be the one it
     * picks up.
     */
    const sanitize = vi.fn();
    vi.doMock("dompurify", () => ({
      default: Object.assign(() => ({ isSupported: false, sanitize }), {
        isSupported: false,
        sanitize,
      }),
    }));
    vi.resetModules();

    const module = await import("@/shared/lib/sanitizeHtml");

    expect(module.sanitizeHtml(`<img src=x onerror="alert(1)">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    expect(sanitize).not.toHaveBeenCalled();
  });
});
