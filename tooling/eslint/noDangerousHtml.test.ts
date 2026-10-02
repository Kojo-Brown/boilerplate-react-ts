// @vitest-environment node
//
// `RuleTester` parses and lints source strings; there is no DOM in sight, and
// the default jsdom environment only slows it down.
import { describe, it, expect } from "vitest";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import {
  isAllowedFile,
  isDocumentReceiver,
  noDangerousHtml,
  securityPlugin,
  staticKeyName,
  staticMemberName,
  unwrapExpression,
} from "./noDangerousHtml";

/**
 * Two layers, for the same reason `logicalProperties.test.ts` has two.
 *
 * The helpers decide what a piece of syntax *is* — which file this is, whether
 * `el[x]` names a known property, whether the thing before `.write()` is a
 * document — and they are tested directly, because each is a place the rule can
 * be wrong in a way that reads as correct.
 *
 * The rule decides what to report, and that is tested through `RuleTester` on
 * real source. The valid cases carry as much weight as the invalid ones here: a
 * ban on `.write()` that reports `stream.write(chunk)` is a ban that gets
 * switched off, and the suite should fail when the rule becomes that.
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

const ALLOW = [{ allow: ["src/shared/ui/RichText.tsx"] }];

describe("isAllowedFile", () => {
  it("matches an absolute path by suffix", () => {
    expect(isAllowedFile("/repo/src/shared/ui/RichText.tsx", ["src/shared/ui/RichText.tsx"])).toBe(
      true,
    );
  });

  it("matches a path spelled with backslashes", () => {
    expect(
      isAllowedFile("C:\\repo\\src\\shared\\ui\\RichText.tsx", ["src/shared/ui/RichText.tsx"]),
    ).toBe(true);
  });

  it("matches the entry on its own, as RuleTester spells it", () => {
    expect(isAllowedFile("src/shared/ui/RichText.tsx", ["src/shared/ui/RichText.tsx"])).toBe(true);
  });

  it("requires a path-segment boundary", () => {
    // The one-character bypass: without the leading `/`, an `allow` entry for
    // `RichText.tsx` would exempt every file whose name ends with it.
    expect(isAllowedFile("/repo/src/features/EvilRichText.tsx", ["RichText.tsx"])).toBe(false);
    expect(isAllowedFile("/repo/src/features/evil/RichText.tsx", ["ui/RichText.tsx"])).toBe(false);
  });

  it("exempts nothing when the list is empty", () => {
    expect(isAllowedFile("/repo/src/shared/ui/RichText.tsx", [])).toBe(false);
  });

  it("tolerates a leading ./ on an entry", () => {
    expect(isAllowedFile("/repo/src/a.tsx", ["./src/a.tsx"])).toBe(true);
  });
});

describe("staticMemberName", () => {
  it("reads a dotted property", () => {
    expect(
      staticMemberName({ computed: false, property: { type: "Identifier", name: "innerHTML" } }),
    ).toBe("innerHTML");
  });

  it("reads a computed string literal", () => {
    expect(
      staticMemberName({ computed: true, property: { type: "Literal", value: "innerHTML" } }),
    ).toBe("innerHTML");
  });

  it("gives up on a computed expression", () => {
    // Deliberate: `el[name] = value` is unknowable here, and reporting every
    // computed access would make the rule unusable. Documented as a gap.
    expect(
      staticMemberName({ computed: true, property: { type: "Identifier", name: "name" } }),
    ).toBe(null);
  });

  it("returns null when there is no property", () => {
    expect(staticMemberName({})).toBe(null);
  });
});

describe("unwrapExpression", () => {
  it("strips the TypeScript wrappers between a call and its receiver", () => {
    const inner = { type: "Identifier", name: "document" };
    for (const type of [
      "TSNonNullExpression",
      "TSAsExpression",
      "TSSatisfiesExpression",
      "TSTypeAssertion",
      "ChainExpression",
    ]) {
      expect(unwrapExpression({ type, expression: inner })).toBe(inner);
    }
  });

  it("strips a stack of them", () => {
    const inner = { type: "Identifier", name: "document" };
    expect(
      unwrapExpression({
        type: "TSNonNullExpression",
        expression: { type: "TSAsExpression", expression: inner },
      }),
    ).toBe(inner);
  });

  it("returns anything else unchanged", () => {
    const node = { type: "Identifier", name: "document" };
    expect(unwrapExpression(node)).toBe(node);
    expect(unwrapExpression(null)).toBe(null);
  });
});

describe("isDocumentReceiver", () => {
  it("recognises the identifiers that hold a document", () => {
    expect(isDocumentReceiver({ type: "Identifier", name: "document" })).toBe(true);
    expect(isDocumentReceiver({ type: "Identifier", name: "doc" })).toBe(true);
  });

  it("recognises a document reached through a member access", () => {
    for (const name of ["document", "contentDocument", "ownerDocument"]) {
      expect(
        isDocumentReceiver({
          type: "MemberExpression",
          computed: false,
          property: { type: "Identifier", name },
        }),
      ).toBe(true);
    }
  });

  it("rejects everything else", () => {
    expect(isDocumentReceiver({ type: "Identifier", name: "stream" })).toBe(false);
    expect(
      isDocumentReceiver({
        type: "MemberExpression",
        computed: false,
        property: { type: "Identifier", name: "response" },
      }),
    ).toBe(false);
    expect(isDocumentReceiver(null)).toBe(false);
    expect(isDocumentReceiver("document")).toBe(false);
  });
});

describe("staticKeyName", () => {
  it("reads shorthand and quoted keys", () => {
    expect(staticKeyName({ computed: false, key: { type: "Identifier", name: "a" } })).toBe("a");
    expect(staticKeyName({ computed: false, key: { type: "Literal", value: "a" } })).toBe("a");
  });

  it("gives up on a computed key and on a non-string one", () => {
    expect(staticKeyName({ computed: true, key: { type: "Identifier", name: "a" } })).toBe(null);
    expect(staticKeyName({ computed: false, key: { type: "Literal", value: 1 } })).toBe(null);
    expect(staticKeyName({ computed: false })).toBe(null);
  });
});

describe("security/no-dangerous-html", () => {
  it("is exported as a plugin under the name the config uses", () => {
    expect(securityPlugin.rules["no-dangerous-html"]).toBe(noDangerousHtml);
  });

  it("links to the policy it enforces", () => {
    // The message tells an author what to do instead; the docs URL tells them
    // why. A rule that only says "no" gets an `eslint-disable` rather than a
    // fix.
    expect(noDangerousHtml.meta?.docs?.url).toContain("docs/xss.md");
  });

  ruleTester.run("no-dangerous-html", noDangerousHtml, {
    valid: [
      {
        name: "rendering a value as a child, which React escapes",
        filename: "src/pages/about/AboutPage.tsx",
        code: `export const A = ({ bio }: { bio: string }) => <p>{bio}</p>;`,
        options: ALLOW,
      },
      {
        name: "textContent, which cannot parse markup",
        filename: "src/shared/lib/x.ts",
        code: `export const set = (el: HTMLElement, s: string) => { el.textContent = s; };`,
        options: ALLOW,
      },
      {
        name: "the allowed file",
        filename: "/repo/src/shared/ui/RichText.tsx",
        code: `export const R = ({ h }: { h: string }) => <div dangerouslySetInnerHTML={{ __html: h }} />;`,
        options: ALLOW,
      },
      {
        name: "a write() that is not a document's",
        filename: "src/shared/lib/x.ts",
        code: `export const f = (stream: { write: (s: string) => void }) => { stream.write("<b>"); };`,
        options: ALLOW,
      },
      {
        name: "an unrelated property called write on a member expression",
        filename: "src/shared/lib/x.ts",
        code: `export const f = (res: { body: { write: (s: string) => void } }) => { res.body.write("x"); };`,
        options: ALLOW,
      },
      {
        name: "a computed assignment the rule deliberately cannot judge",
        filename: "src/shared/lib/x.ts",
        code: `export const f = (el: HTMLElement, k: "title", v: string) => { el[k] = v; };`,
        options: ALLOW,
      },
      {
        // Pinned rather than accidental, and listed in `docs/xss.md` as a known
        // gap. `write` cannot be judged on the method name alone — streams,
        // responses and loggers all have one — so it is judged on the
        // receiver's name, and a document held under a name the rule does not
        // recognise escapes it. The alternative is reporting every `.write()`,
        // which is how a rule gets switched off.
        name: "write on a document under an unrecognised name",
        filename: "src/shared/lib/x.ts",
        code: `export const f = (target: Document, s: string) => { target.write(s); };`,
        options: ALLOW,
      },
      {
        name: "an unrelated prop whose name merely contains the dangerous one",
        filename: "src/pages/home/HomePage.tsx",
        code: `export const A = () => <div data-dangerously-set-inner-html="no" />;`,
        options: ALLOW,
      },
    ],

    invalid: [
      {
        name: "the JSX prop",
        filename: "src/pages/about/AboutPage.tsx",
        code: `export const A = ({ bio }: { bio: string }) => <div dangerouslySetInnerHTML={{ __html: bio }} />;`,
        options: ALLOW,
        errors: [{ messageId: "dangerousProp" }],
      },
      {
        name: "the prop, in a file that is not in the allow list",
        filename: "src/features/blog/Body.tsx",
        code: `export const B = ({ h }: { h: string }) => <div dangerouslySetInnerHTML={{ __html: h }} />;`,
        options: [{ allow: [] }],
        errors: [{ messageId: "dangerousProp" }],
      },
      {
        name: "the prop as an object key, which createElement takes",
        filename: "src/pages/home/HomePage.tsx",
        code: `import { createElement } from "react";
export const A = (h: string) => createElement("div", { dangerouslySetInnerHTML: { __html: h } });`,
        options: ALLOW,
        errors: [{ messageId: "dangerousProp" }],
      },
      {
        name: "the prop as a quoted object key",
        filename: "src/pages/home/HomePage.tsx",
        code: `export const props = { "dangerouslySetInnerHTML": { __html: "x" } };`,
        options: ALLOW,
        errors: [{ messageId: "dangerousProp" }],
      },
      {
        name: "innerHTML assignment",
        filename: "src/shared/lib/x.ts",
        code: `export const f = (el: HTMLElement, s: string) => { el.innerHTML = s; };`,
        options: ALLOW,
        errors: [{ messageId: "htmlSink", data: { sink: "innerHTML" } }],
      },
      {
        name: "innerHTML appended",
        filename: "src/shared/lib/x.ts",
        code: `export const f = (el: HTMLElement, s: string) => { el.innerHTML += s; };`,
        options: ALLOW,
        errors: [{ messageId: "htmlSink" }],
      },
      {
        name: "innerHTML through a computed string literal",
        filename: "src/shared/lib/x.ts",
        code: `export const f = (el: HTMLElement, s: string) => { el["innerHTML"] = s; };`,
        options: ALLOW,
        errors: [{ messageId: "htmlSink" }],
      },
      {
        name: "outerHTML assignment",
        filename: "src/shared/lib/x.ts",
        code: `export const f = (el: HTMLElement, s: string) => { el.outerHTML = s; };`,
        options: ALLOW,
        errors: [{ messageId: "htmlSink", data: { sink: "outerHTML" } }],
      },
      {
        name: "insertAdjacentHTML",
        filename: "src/shared/lib/x.ts",
        code: `export const f = (el: HTMLElement, s: string) => { el.insertAdjacentHTML("beforeend", s); };`,
        options: ALLOW,
        errors: [{ messageId: "htmlSink", data: { sink: "insertAdjacentHTML" } }],
      },
      {
        name: "createContextualFragment, the documented way around an innerHTML ban",
        filename: "src/shared/lib/x.ts",
        code: `export const f = (r: Range, s: string) => r.createContextualFragment(s);`,
        options: ALLOW,
        errors: [{ messageId: "htmlSink", data: { sink: "createContextualFragment" } }],
      },
      {
        name: "document.write",
        filename: "src/shared/lib/x.ts",
        code: `export const f = (s: string) => { document.write(s); };`,
        options: ALLOW,
        errors: [{ messageId: "htmlSink", data: { sink: "document.write" } }],
      },
      {
        name: "document.writeln through window",
        filename: "src/shared/lib/x.ts",
        code: `export const f = (s: string) => { window.document.writeln(s); };`,
        options: ALLOW,
        errors: [{ messageId: "htmlSink", data: { sink: "document.writeln" } }],
      },
      {
        // The case that found the bug: the `!` is a node, so `.write`'s
        // receiver is a `TSNonNullExpression` rather than the member expression
        // it looks like, and the receiver check has to unwrap it.
        name: "write on an iframe's contentDocument, behind a non-null assertion",
        filename: "src/shared/lib/x.ts",
        code: `export const f = (frame: HTMLIFrameElement, s: string) => { frame.contentDocument!.write(s); };`,
        options: ALLOW,
        errors: [{ messageId: "htmlSink", data: { sink: "document.write" } }],
      },
      {
        name: "write on an optional-chained contentDocument",
        filename: "src/shared/lib/x.ts",
        code: `export const f = (frame: HTMLIFrameElement, s: string) => { frame.contentDocument?.write(s); };`,
        options: ALLOW,
        errors: [{ messageId: "htmlSink", data: { sink: "document.write" } }],
      },
      {
        name: "write on a document behind an as-cast",
        filename: "src/shared/lib/x.ts",
        code: `export const f = (doc: unknown, s: string) => { (doc as Document).write(s); };`,
        options: ALLOW,
        errors: [{ messageId: "htmlSink", data: { sink: "document.write" } }],
      },
      {
        name: "the rule with no options at all exempts nothing",
        filename: "/repo/src/shared/ui/RichText.tsx",
        code: `export const R = ({ h }: { h: string }) => <div dangerouslySetInnerHTML={{ __html: h }} />;`,
        errors: [{ messageId: "dangerousProp" }],
      },
    ],
  });
});
