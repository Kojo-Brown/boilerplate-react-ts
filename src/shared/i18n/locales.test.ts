// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  SUPPORTED_TAGS,
  describeLocale,
  directionOf,
  isSupportedLocale,
} from "@/shared/i18n/locales";

describe("SUPPORTED_LOCALES", () => {
  it("includes the default locale", () => {
    // The default is the fallback and the catalogue every other one is typed
    // against; a list that did not contain it would make `describeLocale`
    // throw for the locale the application starts in.
    expect(SUPPORTED_TAGS).toContain(DEFAULT_LOCALE);
  });

  it("declares at least one locale in each direction", () => {
    /*
     * The assertion that keeps the RTL work honest. Every gate in this
     * repository — the axe audit, the token contrast scan, the lint rule — is
     * capable of passing on a list of exclusively left-to-right locales while
     * the mirrored layout is broken, because nothing would ever render it.
     */
    const directions = new Set(SUPPORTED_LOCALES.map((locale) => locale.dir));
    expect([...directions].sort()).toEqual(["ltr", "rtl"]);
  });

  it("uses tags the platform can resolve", () => {
    for (const { tag } of SUPPORTED_LOCALES) {
      // A tag that `Intl` rejects throws a `RangeError` from the first
      // formatter that sees it, which in practice is during the first render.
      expect(() => new Intl.NumberFormat(tag)).not.toThrow();
      expect(Intl.getCanonicalLocales(tag)).toEqual([tag]);
    }
  });

  it("names each locale in its own language", () => {
    // An endonym is the one label legible to the reader looking for it. A
    // switcher labelled in the current UI language fails exactly the person who
    // cannot read the current UI language.
    for (const { endonym } of SUPPORTED_LOCALES) {
      expect(endonym.trim()).not.toBe("");
    }
  });
});

describe("isSupportedLocale", () => {
  it("accepts a declared tag", () => {
    expect(isSupportedLocale("en-GB")).toBe(true);
  });

  it("accepts a declared tag in any casing", () => {
    // BCP-47 casing is a convention, not a rule, and a tag written by hand into
    // a URL or a config file does not always follow it.
    expect(isSupportedLocale("EN-gb")).toBe(true);
  });

  it("rejects a language without the region this application ships", () => {
    // `isSupportedLocale` answers "can I load a catalogue for exactly this tag",
    // not "is this reader served by one of ours" — which is
    // `negotiateLocale`'s question and has a different answer.
    expect(isSupportedLocale("en")).toBe(false);
    expect(isSupportedLocale("ar")).toBe(false);
  });

  it("rejects anything else", () => {
    expect(isSupportedLocale("fr-FR")).toBe(false);
    expect(isSupportedLocale("")).toBe(false);
    expect(isSupportedLocale("not a locale")).toBe(false);
  });
});

describe("describeLocale", () => {
  it("returns the descriptor", () => {
    expect(describeLocale("ar-EG")).toEqual({ tag: "ar-EG", dir: "rtl", endonym: "العربية" });
  });

  it("throws rather than defaulting for a tag that is not in the list", () => {
    /*
     * Unreachable through the type system, and asserted anyway. The alternative
     * implementation — returning an LTR default — is the one that hides the
     * mistake: a mirror-imaged layout rendered the wrong way round is not
     * something a reviewer of the *locale list* would notice.
     */
    // @ts-expect-error the guarantee being tested is the runtime one
    expect(() => describeLocale("fr-FR")).toThrow(/Unsupported locale/);
  });
});

describe("directionOf", () => {
  it.each([
    ["en-GB", "ltr"],
    ["ar-EG", "rtl"],
  ] as const)("%s is %s", (tag, expected) => {
    expect(directionOf(tag)).toBe(expected);
  });
});
