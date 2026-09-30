// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  DATE_FORMATS,
  INTL_FORMATS,
  NUMBER_FORMATS,
  TIME_FORMATS,
  type DateFormatName,
  type NumberFormatName,
  type TimeFormatName,
} from "@/shared/i18n/formats";
import { SUPPORTED_TAGS } from "@/shared/i18n/locales";
import { intlFor } from "@/test/intl";

const INSTANT = new Date("2026-02-04T14:30:00Z");

describe("named formats", () => {
  it("is what the provider hands react-intl", () => {
    // One object, so a format declared here and not wired through is impossible
    // rather than merely unlikely.
    expect(INTL_FORMATS).toEqual({
      date: DATE_FORMATS,
      time: TIME_FORMATS,
      number: NUMBER_FORMATS,
    });
  });

  it("resolves every named format in every locale", () => {
    /*
     * Every name, through the formatter that will look it up, in every locale
     * the application ships. Two things fail here and nowhere else: an option bag
     * `Intl` rejects — `dateStyle` mixed with `month` is a `TypeError`, and it is
     * the natural mistake to make when extending `long` — and a name declared in
     * one of the unions but missing from its record, which react-intl resolves to
     * its own defaults rather than to an error.
     *
     * Iterating the records rather than listing the names, so a format added
     * later is covered without this test being edited.
     */
    for (const locale of SUPPORTED_TAGS) {
      const intl = intlFor(locale);

      for (const format of Object.keys(DATE_FORMATS) as DateFormatName[]) {
        expect(
          () => intl.formatDate(INSTANT, { format }),
          `${locale} date/${format}`,
        ).not.toThrow();
      }
      for (const format of Object.keys(TIME_FORMATS) as TimeFormatName[]) {
        expect(
          () => intl.formatTime(INSTANT, { format }),
          `${locale} time/${format}`,
        ).not.toThrow();
      }
      for (const format of Object.keys(NUMBER_FORMATS) as NumberFormatName[]) {
        expect(
          () => intl.formatNumber(1234.5, { format }),
          `${locale} number/${format}`,
        ).not.toThrow();
      }
    }
  });
});

describe("through react-intl", () => {
  const en = intlFor("en-GB");
  const ar = intlFor("ar-EG");

  it("formats a date by name", () => {
    expect(en.formatDate(INSTANT, { format: "short" })).toBe("04/02/2026");
    expect(en.formatDate(INSTANT, { format: "long" })).toBe("4 February 2026");
  });

  it("leaves the clock convention to the locale", () => {
    // `hour12` is unset on purpose: whether a clock is 12- or 24-hour is one of
    // the things a locale knows and a developer guesses at.
    expect(en.formatTime(INSTANT, { format: "short" })).toMatch(/^\d{2}:\d{2}$/);
    expect(ar.formatTime(INSTANT, { format: "short" })).not.toMatch(/^\d{2}:\d{2}$/);
  });

  it("writes numbers in the locale's own numbering system", () => {
    /*
     * The assertion that catches an interpolated number. `ar-EG` resolves to
     * Eastern Arabic-Indic digits, so a value that went through the formatter and
     * one that was pasted into a string with a template literal are visibly
     * different characters — and only one of them is right.
     */
    expect(en.formatNumber(1234567, { format: "integer" })).toBe("1,234,567");
    expect(ar.formatNumber(1234567, { format: "integer" })).toMatch(/[٠-٩]/);
  });

  it("takes a percentage as a fraction", () => {
    // `Intl.NumberFormat` multiplies by 100. The two conventions colliding is
    // how a dashboard reports 4,200%.
    expect(en.formatNumber(0.42, { format: "percent" })).toBe("42%");
  });

  it("keeps two fraction digits on a decimal", () => {
    expect(en.formatNumber(3, { format: "decimal" })).toBe("3.00");
  });
});
