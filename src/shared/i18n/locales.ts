/**
 * The locales this application ships, and what each one implies.
 *
 * Two, and the second one is Arabic rather than a second European language on
 * purpose. A locale list of `en-GB` and `de-DE` exercises message lookup and
 * nothing else: both are LTR, both pluralise on one/other, both write Western
 * digits. Every bug this layer exists to prevent — a hard-coded `margin-left`,
 * a sentence assembled from fragments, a `{count} items` that reads wrong for
 * two — is invisible under such a pair and obvious under this one.
 *
 * ## What a descriptor deliberately does not carry
 *
 * **No currency.** A currency is a property of the money, not of the reader:
 * a price in pounds is £12.34 whether the page is in English or Arabic, and a
 * locale-keyed currency silently converts nothing while appearing to convert
 * everything — the worst available failure for a number people act on. So
 * currency is always passed with the amount (`formatNumber(v, { style:
 * "currency", currency })`), and `docs/i18n.md` says so where somebody adding
 * a locale will read it.
 *
 * **No `messages`.** Catalogs are loaded, not listed here — see
 * `messages/index.ts`. A descriptor is small, synchronous and safe to import
 * from anywhere, including from the code that runs before the first paint to
 * decide which catalog to fetch.
 *
 * **No `name` in English.** `endonym` is the locale's name in its own
 * language, which is what a language switcher must show: a reader who cannot
 * read the current UI language cannot read "Arabic" either, and "العربية" is
 * legible to exactly the person looking for it.
 */

/** Writing direction, as the `dir` attribute spells it. */
export type Direction = "ltr" | "rtl";

export interface LocaleDescriptor {
  /** BCP-47 tag. Goes into `<html lang>` and into every `Intl` constructor. */
  readonly tag: string;
  readonly dir: Direction;
  /** The locale's name in its own language, for the switcher. */
  readonly endonym: string;
}

export const SUPPORTED_LOCALES = [
  { tag: "en-GB", dir: "ltr", endonym: "English (UK)" },
  { tag: "ar-EG", dir: "rtl", endonym: "العربية" },
] as const satisfies readonly LocaleDescriptor[];

/**
 * The tags the application can render, as a union rather than `string`.
 *
 * `FormatjsIntl.IntlConfig` is augmented with this (see `formatjs.d.ts`), so
 * `createIntl({ locale })` and every `useIntl().locale` comparison is checked
 * against the list above rather than against "any string".
 */
export type LocaleTag = (typeof SUPPORTED_LOCALES)[number]["tag"];

/**
 * The locale used when nothing better is known, and the one whose catalog is
 * the source of truth every other catalog is typed against.
 */
export const DEFAULT_LOCALE: LocaleTag = "en-GB";

const BY_TAG = new Map<string, LocaleDescriptor>(
  SUPPORTED_LOCALES.map((locale) => [locale.tag.toLowerCase(), locale]),
);

/** Every supported tag, in switcher order. */
export const SUPPORTED_TAGS: readonly LocaleTag[] = SUPPORTED_LOCALES.map((locale) => locale.tag);

/** Narrows an arbitrary string to a tag this application supports. */
export function isSupportedLocale(tag: string): tag is LocaleTag {
  return BY_TAG.has(tag.toLowerCase());
}

/** The descriptor for a supported tag. Total, because the tag is checked. */
export function describeLocale(tag: LocaleTag): LocaleDescriptor {
  const descriptor = BY_TAG.get(tag.toLowerCase());
  /*
   * Unreachable while `LocaleTag` is derived from the list above — which is
   * the point of deriving it. Thrown rather than defaulted because a silent
   * fallback here would hand the caller LTR for an RTL locale, and a
   * mirror-imaged layout is not a degradation anybody notices in review.
   */
  if (descriptor === undefined) throw new Error(`Unsupported locale: ${tag}`);
  return descriptor;
}

/** The writing direction for a supported tag. */
export function directionOf(tag: LocaleTag): Direction {
  return describeLocale(tag).dir;
}
