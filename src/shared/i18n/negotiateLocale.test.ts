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

  it("takes the supported list and fallback as arguments", () => {
    // Injected so a test states its own world rather than asserting against
    // whichever locales the application happens to ship today.
    expect(negotiateLocale(["ar-EG"], ["en-GB"], "en-GB")).toBe("en-GB");
  });
});
