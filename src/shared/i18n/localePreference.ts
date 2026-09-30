import { isSupportedLocale, type LocaleTag } from "@/shared/i18n/locales";

/**
 * Where an explicit language choice is kept.
 *
 * `localStorage` rather than a cookie, matching `theme`: this application has
 * no server to send a cookie to, and a cookie on a static origin is a header
 * on every asset request buying nothing. A product that server-renders wants
 * the opposite — the server has to know the language before it writes the
 * first byte — and `docs/i18n.md` says what changes.
 */
const STORAGE_KEY = "locale";

/**
 * The stored choice, or `null`.
 *
 * Every read is validated rather than trusted, because the value outlives the
 * build that wrote it: a locale dropped from `SUPPORTED_LOCALES` is still in
 * the browsers of everyone who chose it, and an unvalidated read would hand
 * that tag to `Intl` and to the catalogue loader — a `RangeError` from one and
 * an `undefined is not a function` from the other, on the visit *after* the
 * locale was removed, which is the visit nobody is testing.
 */
export function readStoredLocale(): LocaleTag | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null && isSupportedLocale(raw)) return raw;
  } catch {
    // Unavailable under private browsing and inside a sandboxed iframe, where
    // the getter itself throws. Having no preference is the correct answer.
  }
  return null;
}

/**
 * Records an explicit choice.
 *
 * Failure is swallowed for the same reason as above, and swallowed *silently*
 * rather than reported: the write is a convenience for the next visit, the
 * language has already changed for this one, and there is nothing the reader
 * or an on-call engineer would do with the news.
 */
export function writeStoredLocale(locale: LocaleTag): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore
  }
}

/** Forgets the explicit choice, so negotiation falls back to the browser. */
export function clearStoredLocale(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
