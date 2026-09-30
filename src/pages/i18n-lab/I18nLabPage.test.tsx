import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { I18nLabPage } from "@/pages/i18n-lab/I18nLabPage";
import { renderWithIntl } from "@/test/intl";

/**
 * The lab is a test instrument, so its own tests assert the things it exists to
 * make visible rather than that it renders.
 */
describe("I18nLabPage", () => {
  it("reports the active locale and direction", () => {
    renderWithIntl(<I18nLabPage />, { locale: "ar-EG" });
    expect(screen.getByTestId("active-locale")).toHaveTextContent("ar-EG");
    expect(screen.getByTestId("active-direction")).toHaveTextContent("rtl");
  });

  it("is headed in the active language", () => {
    renderWithIntl(<I18nLabPage />, { locale: "ar-EG" });
    expect(screen.getByRole("heading", { level: 1, name: "التدويل" })).toBeInTheDocument();
  });

  describe("plurals", () => {
    it("uses the exact-match branch for zero in English", () => {
      // `=0` is chosen ahead of any plural category, which is what lets English
      // say "No notifications" while Arabic keeps the `zero` category it uses
      // for grammatical agreement.
      renderWithIntl(<I18nLabPage />);
      expect(screen.getByTestId("plural-form-0")).toHaveTextContent("No notifications");
    });

    it("collapses to two distinct forms in English", () => {
      renderWithIntl(<I18nLabPage />);
      expect(screen.getByTestId("plural-form-1")).toHaveTextContent("1 notification");
      for (const count of [2, 3, 11, 100]) {
        expect(screen.getByTestId(`plural-form-${String(count)}`)).toHaveTextContent(
          `${String(count)} notifications`,
        );
      }
    });

    it("produces six distinct forms in Arabic", () => {
      /*
       * The assertion the whole lab exists for. A `count === 1` ternary can
       * produce the English column and nothing else; Arabic distinguishes 0, 1,
       * 2, 3–10, 11–99 and 100+, and this is what says so.
       */
      renderWithIntl(<I18nLabPage />, { locale: "ar-EG" });
      const forms = [0, 1, 2, 3, 11, 100].map(
        (count) => screen.getByTestId(`plural-form-${String(count)}`).textContent,
      );
      expect(new Set(forms).size).toBe(6);
    });

    it("writes the counts in the locale's numbering system", () => {
      // A bare `{count}` in Arabic prints Western digits where the locale's own
      // are expected; `#` inside a plural goes through `Intl.NumberFormat`.
      renderWithIntl(<I18nLabPage />, { locale: "ar-EG" });
      expect(screen.getByTestId("plural-count-100")).toHaveTextContent(/[٠-٩]/);
    });
  });

  describe("numbers", () => {
    it("formats a decimal, a percentage, a currency and a unit", () => {
      renderWithIntl(<I18nLabPage />);
      expect(screen.getByTestId("number-decimal")).toHaveTextContent("1,234,567.89");
      expect(screen.getByTestId("number-percent")).toHaveTextContent("42.4%");
      expect(screen.getByTestId("number-currency")).toHaveTextContent("£1,299.00");
      expect(screen.getByTestId("number-unit")).toHaveTextContent("96");
    });

    it("keeps the currency when the language changes", () => {
      /*
       * A locale is not a currency. The digits and the separators are the
       * locale's; the amount and the symbol belong to the money, and a
       * locale-keyed currency would silently convert nothing while appearing to
       * convert everything.
       */
      renderWithIntl(<I18nLabPage />, { locale: "ar-EG" });
      const rendered = screen.getByTestId("number-currency").textContent;

      // Arabic-Indic digits and the locale's own group and decimal separators…
      expect(rendered).toMatch(/[٠-٩]/);
      // …around the same amount, still in pounds. `ar-EG` writes GBP as `UK£`,
      // which is the locale naming the currency rather than changing it.
      expect(rendered).toContain("£");
      expect(rendered.replace(/[^٠-٩]/g, "")).toBe("١٢٩٩٠٠");
    });
  });

  describe("dates", () => {
    it("uses the named formats", () => {
      renderWithIntl(<I18nLabPage />);
      expect(screen.getByTestId("date-short")).toHaveTextContent("04/02/2026");
      expect(screen.getByTestId("date-long")).toHaveTextContent("4 February 2026");
    });

    it("writes the same instant the locale's way", () => {
      renderWithIntl(<I18nLabPage />, { locale: "ar-EG" });
      expect(screen.getByTestId("date-long")).toHaveTextContent(/[٠-٩]/);
    });
  });

  describe("lists", () => {
    it("joins with the locale's own conjunction", () => {
      // Joining with a comma and "and" is English grammar, not punctuation.
      renderWithIntl(<I18nLabPage />);
      expect(screen.getByTestId("list-formatted")).toHaveTextContent("English (UK) and العربية");
    });

    it("uses a different conjunction in Arabic", () => {
      renderWithIntl(<I18nLabPage />, { locale: "ar-EG" });
      expect(screen.getByTestId("list-formatted")).toHaveTextContent("و");
    });
  });

  describe("bidirectional text", () => {
    it("isolates each Latin run with `<bdi>`", () => {
      /*
       * A left-to-right run inside a right-to-left sentence ends at a neutral
       * character — the full stop — whose direction the Unicode bidi algorithm
       * resolves from its surroundings, so the sentence ends in the middle of
       * itself. `<bdi>` is the markup that fixes it, and it has to be in the
       * output rather than in a comment.
       */
      renderWithIntl(<I18nLabPage />, { locale: "ar-EG" });
      const sample = screen.getByTestId("bidi-sample");
      expect(sample.querySelectorAll("bdi")).toHaveLength(2);
      expect(sample).toHaveTextContent("v2.14.0-rc.3");
    });
  });

  it("names no physical side in its own markup", () => {
    // Enforced for the whole of `src/` by `i18n/logical-properties`; asserted
    // here too because this is the page a reviewer looks at to decide whether the
    // mirror works, and a lab that cheated would be the worst possible example.
    renderWithIntl(<I18nLabPage />);
    const classes = [...document.querySelectorAll("[class]")].flatMap((element) =>
      element.className.split(/\s+/),
    );
    expect(
      classes.filter((token) => /^-?(ml|mr|pl|pr|left|right|text-(left|right))(-|$)/.test(token)),
    ).toEqual([]);
  });
});
