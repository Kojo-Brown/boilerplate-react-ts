import { DEFAULT_LOCALE, type LocaleTag } from "@/shared/i18n/locales";
import { EN_GB_MESSAGES, type MessageId } from "@/shared/i18n/messages/en-GB";

export type { MessageId } from "@/shared/i18n/messages/en-GB";

/** A complete set of messages for one locale. */
export type Catalog = Readonly<Record<MessageId, string>>;

/**
 * How each locale's messages are obtained.
 *
 * The default locale is a static import and every other locale is an
 * `import()`, and the asymmetry is deliberate on both sides.
 *
 * **The default is static** because it is the fallback. react-intl resolves a
 * missing or malformed message by falling back to `defaultLocale`, and a
 * fallback that has to be fetched is not a fallback — it is a second thing that
 * can fail, at the moment something has already failed.
 *
 * **The others are dynamic** because a reader gets one of them at most. The
 * catalogues are small today, but a translated application's catalogues grow
 * with the product and there is no version of "ship every language to every
 * reader" that ends well. Vite gives each `import()` its own chunk, so adding a
 * locale costs the initial bundle nothing.
 *
 * The specifiers stay literal: a computed one produces a glob, which is how
 * every locale ends up in the graph again by accident.
 */
const LOADERS: Record<LocaleTag, () => Promise<Catalog>> = {
  "en-GB": () => Promise.resolve(EN_GB_MESSAGES),
  "ar-EG": () => import("@/shared/i18n/messages/ar-EG").then((module) => module.AR_EG_MESSAGES),
};

/** The default locale's catalogue, available without awaiting anything. */
export const DEFAULT_CATALOG: Catalog = EN_GB_MESSAGES;

const MESSAGE_IDS: ReadonlySet<string> = new Set(Object.keys(EN_GB_MESSAGES));

/**
 * The catalogue for a locale.
 *
 * A rejected chunk load is not caught here. The caller is the only code that
 * knows what to do about it — `bootstrap.ts` starts the application in the
 * default locale, and `I18nProvider` leaves the current locale in place — and a
 * `catch` that returned the default catalogue would make both of those
 * decisions invisibly, while reporting a successful switch to a language the
 * reader is not getting.
 */
export function loadCatalog(locale: LocaleTag): Promise<Catalog> {
  return LOADERS[locale]();
}

/**
 * Whether `value` is an id the catalogues declare.
 *
 * `MessageId` is erased at runtime, and there are two places a message id
 * arrives as an unchecked `string`: a route `handle`, which React Router reports
 * as `unknown`, and anything read out of a URL or storage. A guard here rather
 * than a cast at each of them keeps the set of valid ids in one place — the
 * source catalogue — so a rename cannot leave a stale literal behind that still
 * looks like an id.
 */
export function isMessageId(value: unknown): value is MessageId {
  return typeof value === "string" && MESSAGE_IDS.has(value);
}

/** True when `locale` needs no network to render. */
export function isCatalogPreloaded(locale: LocaleTag): boolean {
  return locale === DEFAULT_LOCALE;
}
