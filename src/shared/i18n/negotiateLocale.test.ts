// @vitest-environment node
import { describe, it, expect } from "vitest";
import { negotiateLocale } from "@/shared/i18n/negotiateLocale";
import { DEFAULT_LOCALE } from "@/shared/i18n/locales";

describe("negotiateLocale", () => {
  it("matches an exact tag", () => {
    expect(negotiateLocale(["ar-EG"])).toBe("ar-EG");
  });

  it("matches an exact tag regardless of casing", () => {
    expect(negotiateLocale(["AR-eg"])).toBe("ar-EG");
  });

  it("matches a bare language to the region this application ships", () => {
    // What most browsers actually send, and the case a strict tag comparison
    // gets wrong for every reader at once.
    expect(negotiateLocale(["ar"])).toBe("ar-EG");
  });

  it("prefers a different region of the requested language over another language", () => {
    /*
     * The rule that matters most and is easiest to get backwards. A reader
     * asking for Saudi Arabic and offered Egyptian Arabic or English is served
     * by Arabic: the difference between the two Arabics is vocabulary, the
     * difference from English is literacy.
     */
    expect(negotiateLocale(["ar-SA"])).toBe("ar-EG");
    expect(negotiateLocale(["en-US"])).toBe("en-GB");
  });

  it("does not demote a region mismatch below the next preference", () => {
    // `ar-SA` fails the exact test and passes the language test, and it has to
    // be resolved before `en-GB` is considered at all — the reader said Arabic
    // first. Falling through to the next *requested* tag on a region mismatch
    // would serve them English.
    expect(negotiateLocale(["ar-SA", "en-GB"])).toBe("ar-EG");
  });

  it("honours the reader's order, not the application's", () => {
    // Iterating the supported list in the outer loop would answer with
    // whichever of ours is declared first, which is a preference belonging to
    // the developer.
    expect(negotiateLocale(["de-DE", "ar-EG", "en-GB"])).toBe("ar-EG");
    expect(negotiateLocale(["de-DE", "en-GB", "ar-EG"])).toBe("en-GB");
  });

  it("falls back when nothing matches", () => {
    expect(negotiateLocale(["fr-FR", "de-DE"])).toBe(DEFAULT_LOCALE);
  });

  it("falls back for an empty list", () => {
    // `navigator.languages` is `[]` in a few embedded WebViews.
    expect(negotiateLocale([])).toBe(DEFAULT_LOCALE);
  });

  it("skips malformed entries rather than throwing", () => {
    /*
     * Every caller's input comes from outside the program — storage written by
     * an older build, an `Accept-Language` header, a query parameter somebody
     * typed. The only useful response to junk is the next candidate.
     */
    expect(negotiateLocale(["", "   ", ";;", "ar"])).toBe("ar-EG");
  });

  it("reads a POSIX-style underscore tag", () => {
    // What an `LC_ALL` copied into a config file looks like.
    expect(negotiateLocale(["ar_EG"])).toBe("ar-EG");
  });

  /*
   * Rule 1 (exact tag) and rule 2 (same language, any region) are separate
   * rules, and against the two locales this application ships they are
   * indistinguishable: `en-GB` and `ar-EG` are the only region of their
   * language, so rule 2 reproduces rule 1's answer for every input above.
   * Deleting the exact match entirely left all of them passing.
   *
   * These two state a world with two regions of one language, which is the
   * only arrangement in which the priority is observable — and the arrangement
   * any second English or Arabic catalog would create.
   */
  it("prefers the exact tag over another region of the same language", () => {
    expect(negotiateLocale(["en-US"], ["en-GB", "en-US"], "en-GB")).toBe("en-US");
  });

  it("falls back to another region only once the exact tag is not on offer", () => {
    expect(negotiateLocale(["en-AU"], ["en-GB", "en-US"], "en-GB")).toBe("en-GB");
  });

  it("trims a stored tag before matching it", () => {
    /*
     * Whitespace survives a round trip through a config file or a hand-edited
     * `localStorage` value. Untrimmed, `" ar-EG "` fails the exact test and
     * then has its language subtag read as `" ar"`, so it fails rule 2 as well
     * and the reader is served the fallback — the one input shape where a
     * missing `trim()` costs a whole locale rather than nothing.
     */
    expect(negotiateLocale([" ar-EG "])).toBe("ar-EG");
    expect(negotiateLocale(["\tar\n"])).toBe("ar-EG");
  });

  it("takes the supported list and fallback as arguments", () => {
    // Injected so a test states its own world rather than asserting against
    // whichever locales the application happens to ship today.
    expect(negotiateLocale(["ar-EG"], ["en-GB"], "en-GB")).toBe("en-GB");
  });
});
