import { DEFAULT_LOCALE, SUPPORTED_TAGS, type LocaleTag } from "@/shared/i18n/locales";

/**
 * Picks the best supported locale for a list of requested ones.
 *
 * The requested list is whatever the environment offers, in the reader's own
 * order of preference: a stored choice first, then `navigator.languages`.
 *
 * ## Why this is not `Intl.LocaleMatcher`
 *
 * There isn't one. `localeMatcher: "lookup"` is an option on the `Intl`
 * formatters and resolves against *their* data, not against an application's
 * catalog list, so it cannot answer "which of my two translations should this
 * reader get". The matching below is RFC 4647 lookup, narrowed to what a
 * two-level tag actually needs.
 *
 * ## The three rules, and the order they are in
 *
 * 1. **Exact tag, case-insensitively.** `en-gb` and `en-GB` are the same
 *    request; the BCP-47 casing convention is a convention, and a header
 *    written by hand does not always follow it.
 * 2. **Same language, any region.** A reader asking for `ar-SA` is far better
 *    served by `ar-EG` than by English — the difference between Saudi and
 *    Egyptian Arabic is vocabulary, the difference from English is literacy.
 *    This is also what makes a bare `ar` work, which is what most browsers
 *    actually send.
 * 3. **Fallback**, once every requested tag has failed both tests.
 *
 * The loop is over *requested* tags in the outer position, not supported ones,
 * and that ordering is the whole contract. A reader whose list is `["de",
 * "ar"]` gets Arabic; iterating the supported list first would give them
 * whichever of ours happened to be declared earlier, which is a preference
 * belonging to the developer rather than the reader. The inner fallthrough is
 * per requested tag as well: `["ar-SA", "en-GB"]` resolves to `ar-EG` on rule
 * 2 rather than reaching `en-GB` on rule 1, because `ar-SA` is the stronger
 * preference and a region mismatch does not demote it below the next entry.
 *
 * ## Malformed input
 *
 * Anything unparseable is skipped, not thrown on. Every caller's input arrives
 * from outside the program — a `localStorage` value written by an older build,
 * an `Accept-Language` header, a query parameter someone typed — and the only
 * useful response to "q=;;" is to carry on to the next candidate. The
 * primitive subtag split below cannot throw, so there is nothing to catch: an
 * empty or junk tag simply matches nothing.
 */
export function negotiateLocale(
  requested: readonly string[],
  supported: readonly LocaleTag[] = SUPPORTED_TAGS,
  fallback: LocaleTag = DEFAULT_LOCALE,
): LocaleTag {
  for (const candidate of requested) {
    const wanted = candidate.trim().toLowerCase();
    if (wanted === "") continue;

    const exact = supported.find((tag) => tag.toLowerCase() === wanted);
    if (exact !== undefined) return exact;

    const language = languageSubtag(wanted);
    if (language === "") continue;

    const sameLanguage = supported.find((tag) => languageSubtag(tag.toLowerCase()) === language);
    if (sameLanguage !== undefined) return sameLanguage;
  }

  return fallback;
}

/**
 * The primary language subtag of a lower-cased tag.
 *
 * Both separators, because `en_GB` reaches this function often enough to be
 * worth two characters: POSIX environment variables spell a locale that way,
 * and it is what an `LC_ALL` copied into a config file looks like.
 */
function languageSubtag(lowerCaseTag: string): string {
  const separator = lowerCaseTag.search(/[-_]/);
  return separator === -1 ? lowerCaseTag : lowerCaseTag.slice(0, separator);
}
