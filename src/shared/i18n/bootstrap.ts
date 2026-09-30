import { DEFAULT_LOCALE, type LocaleTag } from "@/shared/i18n/locales";
import { negotiateLocale } from "@/shared/i18n/negotiateLocale";
import { readStoredLocale } from "@/shared/i18n/localePreference";
import { DEFAULT_CATALOG, loadCatalog, type Catalog } from "@/shared/i18n/messages";

/** The locale and messages the first render is given. */
export interface I18nBootstrap {
  readonly locale: LocaleTag;
  readonly messages: Catalog;
}

export interface ResolveI18nOptions {
  /**
   * The languages the environment offers, most-preferred first.
   *
   * Injected rather than read from `navigator` inside, so the negotiation can
   * be tested against a list instead of against a patched global — and so a
   * server-rendered build can pass `Accept-Language` through the same function.
   * Defaults to the browser's list.
   */
  readonly preferred?: readonly string[];
  /**
   * How a catalogue is obtained. Defaults to `loadCatalog`.
   *
   * Injected for the same reason as `preferred`, and for one more: the
   * interesting case is the one where it *fails*, and a chunk that 404s is not
   * something a test can arrange by patching a global. A module mock would do
   * it, at the price of a test that breaks when this file's imports are
   * reordered.
   */
  readonly loadMessages?: (locale: LocaleTag) => Promise<Catalog>;
  /** Where a failed catalogue load is reported. Defaults to silence. */
  readonly onError?: (error: unknown) => void;
}

/**
 * Chooses the locale and loads its messages, before the first render.
 *
 * ## Why this is awaited in `main.tsx` rather than suspended on
 *
 * A provider that loads its own catalogue has to render *something* first, and
 * every available something is wrong. English-then-Arabic is a visible flash of
 * the wrong language, and in an RTL locale it is a flash of the whole layout
 * mirrored. A Suspense fallback is a blank screen whose duration is a network
 * fetch. Resolving before `createRoot().render()` costs one `import()` on the
 * critical path for a non-default locale and nothing at all for the default —
 * and the first paint is correct in both directions, which is the only version
 * of this a reader experiences as "the site is in my language".
 *
 * Switching *after* the first render is a different problem with a different
 * answer; `I18nProvider` holds it.
 *
 * ## Falling back
 *
 * A rejected catalogue load starts the application in the default locale rather
 * than failing. The alternative is a blank page for a reader whose only offence
 * was preferring a language whose chunk 404s — a stale `index.html` against a
 * new deploy is the ordinary way that happens, and it resolves itself on the
 * next load. The error is reported so it does not resolve itself silently.
 */
export async function resolveI18n(options: ResolveI18nOptions = {}): Promise<I18nBootstrap> {
  const { preferred = browserLanguages(), loadMessages = loadCatalog, onError } = options;

  const stored = readStoredLocale();
  /*
   * A stored choice is not merely first in the list, it is the whole list.
   *
   * Prepending it to `navigator.languages` would work today and stop working
   * the moment a locale is retired: `readStoredLocale` returns `null` for a tag
   * this build no longer supports, which is correct, but a *supported* stored
   * tag must never be negotiated away in favour of a browser preference that
   * happens to match more exactly. Choosing a language explicitly is the reader
   * saying their browser is wrong about them.
   */
  const locale = stored ?? negotiateLocale(preferred);

  if (locale === DEFAULT_LOCALE) return { locale, messages: DEFAULT_CATALOG };

  try {
    return { locale, messages: await loadMessages(locale) };
  } catch (error) {
    onError?.(error);
    return { locale: DEFAULT_LOCALE, messages: DEFAULT_CATALOG };
  }
}

/**
 * The browser's language list.
 *
 * `navigator.languages` is the ordered list and `navigator.language` is the
 * single most-preferred one; the plural form is absent in a few embedded
 * WebViews, where the singular is all there is. Read defensively rather than
 * asserted, because this runs before anything else in the application and a
 * `TypeError` here is a blank page.
 */
function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];

  // Read as `unknown` and narrowed by hand. The declared type says
  // `readonly string[]`, and the whole reason this function exists is that the
  // declaration is optimistic about environments where the property is missing
  // or holds something else.
  const languages: unknown = navigator.languages;
  if (Array.isArray(languages)) {
    const tags = languages.filter((tag): tag is string => typeof tag === "string");
    if (tags.length > 0) return tags;
  }

  const language: unknown = navigator.language;
  return typeof language === "string" && language !== "" ? [language] : [];
}
