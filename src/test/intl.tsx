import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { createIntl, type IntlShape } from "react-intl";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import { DEFAULT_LOCALE, type LocaleTag } from "@/shared/i18n/locales";
import { INTL_FORMATS } from "@/shared/i18n/formats";
import { EN_GB_MESSAGES } from "@/shared/i18n/messages/en-GB";
import { AR_EG_MESSAGES } from "@/shared/i18n/messages/ar-EG";
import type { Catalog } from "@/shared/i18n/messages";

/**
 * Both catalogues, statically.
 *
 * The application loads every non-default catalogue with an `import()`, which is
 * right for a browser and wrong for a test: a component test would have to await
 * a chunk before it could assert on a heading. Importing both here costs a test
 * bundle nothing and makes `renderWithIntl(ui, { locale: "ar-EG" })` synchronous.
 *
 * Typed as `Catalog`, so a test fixture cannot be a partial catalogue that
 * happens to contain the ids one test needs.
 */
const CATALOGS: Record<LocaleTag, Catalog> = {
  "en-GB": EN_GB_MESSAGES,
  "ar-EG": AR_EG_MESSAGES,
};

export interface IntlHarnessOptions {
  readonly locale?: LocaleTag;
}

/**
 * The real `I18nProvider`, with a catalogue already in hand.
 *
 * The real one rather than a bare `IntlProvider`, because most of what is worth
 * testing about this layer is the provider's own behaviour: `<html dir>`,
 * `<html lang>`, the announcement on switching, and `useI18n`. A test that
 * substituted `IntlProvider` would pass while none of that worked.
 *
 * No `onError` is passed, which is the point: `I18nProvider` re-throws outside
 * production when nothing is listening, so a malformed message or a missing
 * placeholder value fails the test that rendered it.
 */
export function TestI18nProvider({
  children,
  locale = DEFAULT_LOCALE,
}: { readonly children: ReactNode } & IntlHarnessOptions) {
  return (
    <I18nProvider initialLocale={locale} initialMessages={CATALOGS[locale]}>
      {children}
    </I18nProvider>
  );
}

/** `render`, with the i18n layer around it. */
export function renderWithIntl(
  ui: ReactElement,
  { locale = DEFAULT_LOCALE, ...options }: IntlHarnessOptions & Omit<RenderOptions, "wrapper"> = {},
) {
  return render(ui, {
    wrapper: ({ children }) => <TestI18nProvider locale={locale}>{children}</TestI18nProvider>,
    ...options,
  });
}

/**
 * An `IntlShape` for a locale, with no React involved.
 *
 * For the pure functions that take one — `documentTitle`, `routeAnnouncement` —
 * where rendering a provider to find out what a string would have been is both
 * slower and less direct than asking.
 */
export function intlFor(locale: LocaleTag = DEFAULT_LOCALE): IntlShape {
  return createIntl({
    locale,
    defaultLocale: DEFAULT_LOCALE,
    messages: CATALOGS[locale],
    formats: INTL_FORMATS,
    onError: (error) => {
      throw error;
    },
  });
}

/**
 * Puts `<html lang>` and `<html dir>` back.
 *
 * `I18nProvider` writes both to `document.documentElement`, which jsdom shares
 * across every test in a file — so an Arabic test leaves the document RTL for
 * whatever renders next, and a later assertion about direction passes for the
 * wrong reason. Called from `setup.ts` after each test rather than from each
 * suite, because the suites that need it are the ones that do not mention
 * direction at all.
 *
 * A no-op with no document. `setup.ts` runs for every suite, and the pure ones
 * opt into `@vitest-environment node`, where there is no `document` to reset — a
 * bare reference would fail every such suite in its teardown.
 */
export function resetDocumentDirection(): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = DEFAULT_LOCALE;
  document.documentElement.dir = "ltr";
}
