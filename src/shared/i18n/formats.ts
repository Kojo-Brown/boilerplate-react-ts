/**
 * Named date, time and number formats, declared once.
 *
 * react-intl takes a `formats` prop and then lets every call site ask for a
 * format by name: `formatDate(d, { format: "long" })`. The alternative is an
 * options object at each call site, and the failure mode of that is drift —
 * one screen showing "4 Feb 2026" and the next "04/02/2026", from two
 * developers who each picked something reasonable. A name is a decision made
 * once and reused; an options bag is a decision remade every time.
 *
 * The names are also type-checked. `FormatjsIntl.Formats` is augmented with the
 * unions below (see `formatjs.d.ts`), so `{ format: "medium" }` — a name this
 * application has not declared — is a compile error rather than a silent
 * fallback to the formatter's own defaults, which is what react-intl does at
 * runtime with an unknown name.
 *
 * ## What is deliberately absent
 *
 * **No `timeZone`.** Left unset, the formatters use the reader's own zone,
 * which is right for every timestamp in this application: they are all "when
 * did this happen to me". A product with a fixed business timezone sets it on
 * the provider, once, rather than per call — and `docs/i18n.md` says where.
 *
 * **No currency.** A named `currency` format would have to name a currency,
 * and that belongs to the amount rather than to the format or the locale. See
 * the note in `locales.ts`.
 */
import type { CustomFormats } from "react-intl";

/**
 * The three record types below are react-intl's own, not `Record<name,
 * Intl.…Options>`, and the difference is load-bearing twice over.
 *
 * The option bags differ: `@formatjs/ecma402-abstract` declares a
 * `NumberFormatOptions` superset carrying the Unicode extension keys its
 * polyfills implement, and under `exactOptionalPropertyTypes` that type and
 * `Intl.NumberFormatOptions` are not mutually assignable.
 *
 * The keys differ too, and in the useful direction: `CustomFormats` is keyed by
 * the very unions declared above, because `formatjs.d.ts` feeds them into
 * `FormatjsIntl.Formats`. So a name added to `DateFormatName` and not defined
 * here is a missing property rather than an unused type — the two halves of a
 * named format cannot drift apart.
 */
type NamedDateFormats = NonNullable<CustomFormats["date"]>;
type NamedTimeFormats = NonNullable<CustomFormats["time"]>;
type NamedNumberFormats = NonNullable<CustomFormats["number"]>;

/** Named `formatDate` / `<FormattedDate>` formats. */
export type DateFormatName = "short" | "long" | "dayMonth";

/** Named `formatTime` / `<FormattedTime>` formats. */
export type TimeFormatName = "short";

/** Named `formatNumber` / `<FormattedNumber>` formats. */
export type NumberFormatName = "integer" | "decimal" | "percent";

export const DATE_FORMATS: NamedDateFormats = {
  /** `04/02/2026` in en-GB. Numeric, for tables and dense lists. */
  short: { year: "numeric", month: "2-digit", day: "2-digit" },
  /**
   * `4 February 2026`. The spelled-out month, for prose.
   *
   * `month: "long"` rather than `dateStyle: "long"`, because `dateStyle`
   * cannot be combined with the individual component options — mixing the two
   * throws a `TypeError` — and a named format that cannot be extended by a
   * call site is a dead end the first time somebody needs a weekday.
   */
  long: { year: "numeric", month: "long", day: "numeric" },
  /** `4 Feb`. For axis labels and anywhere the year is already established. */
  dayMonth: { month: "short", day: "numeric" },
};

export const TIME_FORMATS: NamedTimeFormats = {
  /**
   * `14:30` in en-GB, `٢:٣٠ م` in ar-EG.
   *
   * `hour12` is left unset on purpose: whether a clock is 12- or 24-hour is
   * one of the things a locale knows and a developer guesses at.
   */
  short: { hour: "numeric", minute: "2-digit" },
};

export const NUMBER_FORMATS: NamedNumberFormats = {
  /** A count. No fraction digits, grouped. */
  integer: { maximumFractionDigits: 0 },
  /** A measured quantity, to two places. */
  decimal: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  /**
   * A proportion. Takes the *fraction* — `0.42`, not `42` — because that is
   * what `Intl.NumberFormat` multiplies by 100, and the two conventions
   * colliding is how a dashboard ends up reporting 4,200%.
   */
  percent: { style: "percent", maximumFractionDigits: 1 },
};

/** The shape react-intl's `formats` prop expects. */
export const INTL_FORMATS: CustomFormats = {
  date: DATE_FORMATS,
  time: TIME_FORMATS,
  number: NUMBER_FORMATS,
};
