import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { IntlProvider, useIntl } from "react-intl";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  describeLocale,
  directionOf,
  type Direction,
  type LocaleTag,
} from "@/shared/i18n/locales";
import { INTL_FORMATS } from "@/shared/i18n/formats";
import { loadCatalog, type Catalog } from "@/shared/i18n/messages";
import { writeStoredLocale } from "@/shared/i18n/localePreference";
import { announce } from "@/shared/a11y/announcer";

export interface I18nContextValue {
  readonly locale: LocaleTag;
  /** The current locale's writing direction, mirroring `<html dir>`. */
  readonly direction: Direction;
  /**
   * Switches language. A no-op for the current locale, and asynchronous for
   * any locale whose catalogue is not already loaded.
   */
  readonly setLocale: (locale: LocaleTag) => void;
  /** True while a switch is loading a catalogue. */
  readonly isSwitching: boolean;
  readonly locales: typeof SUPPORTED_LOCALES;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export interface I18nProviderProps {
  readonly children: ReactNode;
  /**
   * The locale and messages the first render uses, from `resolveI18n()`.
   *
   * Required, and passed in rather than resolved here, because resolving it is
   * asynchronous and the first paint must already be right — a provider that
   * negotiated internally would render the default locale for one commit, which
   * in an RTL locale is the entire layout flashing mirrored. `docs/i18n.md`
   * has the reasoning; `bootstrap.ts` has the code.
   */
  readonly initialLocale: LocaleTag;
  readonly initialMessages: Catalog;
  /**
   * Where a formatting error or a failed catalogue load is reported.
   *
   * Optional, and what happens without it is the point: outside production the
   * error is re-thrown, so a malformed ICU string or a missing placeholder
   * value fails a test instead of printing a warning nobody reads. In
   * production an unreported formatting error is still better than a blank
   * page, so `main.tsx` passes the reporter.
   */
  readonly onError?: (error: unknown) => void;
  /**
   * How a catalogue is obtained when the language changes. Defaults to
   * `loadCatalog`.
   *
   * Injected for the same reason `bootstrap.ts` injects it: the behaviour worth
   * testing is what happens when a chunk *fails*, and an `import()` of a module
   * that exists cannot be made to reject from outside. The alternative is a
   * module mock, which resets the provider's context identity along with the
   * module and takes every consumer in the test with it.
   */
  readonly loadMessages?: (locale: LocaleTag) => Promise<Catalog>;
}

/**
 * The application's one `IntlProvider`, plus the two things react-intl does not
 * do: it owns the current locale, and it keeps the document in sync with it.
 *
 * ## Why `<html lang>` and `<html dir>` are set here
 *
 * Neither is cosmetic and neither belongs to a component further down.
 *
 * `lang` is what a screen reader reads to choose a voice and pronunciation
 * rules. An Arabic page marked `lang="en"` is read out by an English
 * synthesiser, which is not "accented" — it is unintelligible.
 *
 * `dir` is what makes every logical CSS property in the application resolve the
 * other way round. That is the whole of the RTL layout pass: one attribute, and
 * `margin-inline-start` means the right-hand side. Nothing in `src/` names a
 * physical side — `tooling/eslint/logicalProperties.ts` is the rule that keeps
 * it that way — so there is no second stylesheet and no mirrored copy of
 * anything.
 *
 * Set in an effect rather than during render because they are writes to a node
 * outside the React tree; and set on `documentElement` rather than on a wrapper
 * `<div>` because form controls, `<dialog>`, scrollbar placement and the
 * browser's own bidi resolution read it from the root.
 *
 * ## Why switching is a transition
 *
 * Changing language throws away every rendered string. Wrapped in
 * `useTransition`, React keeps the current page interactive while the new
 * catalogue is fetched and commits both — the new messages and the new
 * direction — in one go. The alternative shows a half-translated tree, or a
 * spinner over content that was perfectly readable a moment ago.
 *
 * The state update after the `await` is wrapped in `startTransition` a second
 * time, which is not redundant: React 19 ends the transition scope at the first
 * suspension point, so an update made after it is an ordinary synchronous one
 * and would commit outside the transition.
 */
export function I18nProvider({
  children,
  initialLocale,
  initialMessages,
  onError,
  loadMessages = loadCatalog,
}: I18nProviderProps) {
  "use memo";

  const [{ locale, messages }, setActive] = useState<{
    locale: LocaleTag;
    messages: Catalog;
  }>(() => ({ locale: initialLocale, messages: initialMessages }));
  const [isSwitching, startTransition] = useTransition();

  const report = (error: unknown): void => {
    if (onError !== undefined) {
      onError(error);
      return;
    }
    /*
     * No reporter and not production: the error is the test result. A
     * `console.error` here would be swallowed by whichever suite is running and
     * the defect would ship with its own log line as evidence that somebody
     * knew.
     */
    if (!import.meta.env.PROD) throw error;
  };

  const direction = directionOf(locale);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = direction;
  }, [locale, direction]);

  const setLocale = (next: LocaleTag): void => {
    if (next === locale) return;

    startTransition(async () => {
      try {
        const catalog = await loadMessages(next);
        /*
         * Written before the commit, not after, and not in an effect keyed on
         * the locale. An effect would also record a locale the reader never
         * chose — the negotiated one from their browser — and a stored
         * preference means "this reader overrode their browser". Recording the
         * negotiated value would make the override permanent on first visit and
         * silently stop honouring a changed browser setting.
         */
        writeStoredLocale(next);
        startTransition(() => {
          setActive({ locale: next, messages: catalog });
        });
      } catch (error) {
        // The current locale stays. A half-applied switch — direction changed,
        // messages not — is the one outcome worse than no switch at all.
        report(error);
      }
    });
  };

  const value: I18nContextValue = {
    locale,
    direction,
    setLocale,
    isSwitching,
    locales: SUPPORTED_LOCALES,
  };

  return (
    <I18nContext.Provider value={value}>
      <IntlProvider
        locale={locale}
        defaultLocale={DEFAULT_LOCALE}
        messages={messages}
        /*
         * `defaultLocale` is declared but no second catalogue is merged in
         * behind the active one, and the omission is the design rather than a
         * gap. react-intl's fallback chain answers "this id is missing", which
         * every catalogue but the source one is typed against
         * (`Record<MessageId, string>`) and therefore cannot be. What it does
         * not answer is "this id is present and its ICU is malformed": on a
         * parse error react-intl returns the raw message, not the raw id, and
         * merging English underneath would not change that. The gate for that
         * class of defect is `catalogs.test.ts`, which formats every message in
         * every locale.
         */
        formats={INTL_FORMATS}
        onError={report}
      >
        {/*
          Inside the provider because it formats its own announcement, and
          therefore has to be a consumer of the intl it is announcing.
        */}
        <LocaleChangeAnnouncer />
        {children}
      </IntlProvider>
    </I18nContext.Provider>
  );
}

/**
 * Says, in the new language, that the language changed.
 *
 * Without it a switch is silent to a screen reader: every string on the page
 * has been replaced, the reader is told none of it, and the next thing they
 * hear is whatever they were about to interact with — in a language that was
 * not the one they were reading. The announcement is in the new locale on
 * purpose; it is the first sentence of the new language, and a reader who chose
 * it is the one person guaranteed to understand it.
 *
 * Renders nothing. `announce()` writes to a store whose only subscriber is the
 * `<LiveRegions>` leaf mounted at the root of the tree, so this component does
 * not need to be anywhere near a region — and the regions have been in the
 * document since the first paint, which is what makes the mutation audible.
 */
function LocaleChangeAnnouncer() {
  const intl = useIntl();
  const previousRef = useRef<LocaleTag | null>(null);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = intl.locale;
    // The first commit is not a change. A reader who arrives on an Arabic page
    // is not told that it is Arabic.
    if (previous === null || previous === intl.locale) return;

    announce(
      intl.formatMessage(
        { id: "locale.changed" },
        { language: describeLocale(intl.locale).endonym },
      ),
    );
  }, [intl]);

  return null;
}

/** The current locale and the way to change it. */
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (context === null) throw new Error("useI18n must be used within an I18nProvider");
  return context;
}
