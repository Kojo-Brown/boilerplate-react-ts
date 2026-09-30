/**
 * The source catalogue: every message this application can display, in the
 * language it was written in.
 *
 * ## Why this is a module and not a `.json` file
 *
 * `MessageId` is `keyof typeof EN_GB_MESSAGES`, and every other catalogue is
 * declared as `Record<MessageId, string>`. That single line is what makes a
 * half-finished translation a type error rather than a gap somebody notices in
 * production: a missing key fails `tsc`, and so does a key that no longer
 * exists here because the message was renamed. A JSON catalogue read through
 * `resolveJsonModule` would give the same keys, but it cannot carry the
 * comments below, and the comments are half of what a translator needs.
 *
 * The ids are `area.thing` rather than the English text. Text-as-id reads
 * beautifully until the copy changes: "Sign in" → "Log in" is then a rename
 * across every catalogue, and the ids stop being stable identifiers at exactly
 * the moment translators are relying on them to be.
 *
 * ## Writing a message
 *
 * - **One message per sentence.** Never assemble a sentence from fragments at
 *   the call site: word order is not a constant across languages, and a
 *   fragment has no grammatical context a translator can work from.
 * - **Plurals through ICU `plural`, never through `count === 1`.** English has
 *   two forms and Arabic has six; a ternary in a component can only ever be
 *   right about one language. `{count, plural, ...}` moves that decision into
 *   the catalogue, where each language answers it for itself.
 * - **Numbers and dates through the formatters**, not interpolated. A bare
 *   `{count}` in Arabic prints Western digits where the locale's own numbering
 *   system is expected; `#` inside a plural and `{value, number}` elsewhere go
 *   through `Intl.NumberFormat`, which knows that.
 */
export const EN_GB_MESSAGES = {
  // ── Application shell ───────────────────────────────────────────────────
  "nav.main": "Main navigation",
  /*
   * Two names for one element, because it is two different things depending on
   * the viewport. Below `md` the sidebar is a modal dialog whose accessible name
   * is `nav.drawer`; the `<nav>` landmark inside it keeps `nav.sidebar`. They
   * have to differ: two nested elements with the same name is a rotor listing
   * that reads "Sidebar navigation, Sidebar navigation".
   */
  "nav.drawer": "Navigation",
  "nav.sidebar": "Sidebar navigation",
  "nav.toggleSidebar": "Toggle sidebar",
  "nav.home": "Home",
  "nav.dashboard": "Dashboard",
  "nav.about": "About",
  "skipLink.mainContent": "Skip to main content",

  /*
   * The document title, as one message rather than a template in code.
   *
   * The separator is part of the translation: `·` between a page name and a
   * product name is a Latin-typographic convention, and a locale is free to
   * replace it — as is the order of the two halves, which is why both are
   * placeholders and neither is concatenated at the call site.
   */
  "document.title": "{page} · {app}",
  "document.titleFallback": "{app}",
  /*
   * What the route announcer's live region says on arrival. "…, page loaded"
   * rather than a bare page name, because a polite region speaks into whatever
   * the reader was doing and a lone noun is indistinguishable from a label read
   * out of the page.
   */
  "route.announcement": "{page}, page loaded",

  // ── Language switcher ───────────────────────────────────────────────────
  "locale.label": "Language",
  "locale.pending": "Changing language…",
  /*
   * Spoken after a switch completes. The language's own name is interpolated
   * from the descriptor's endonym, so this sentence is the only part that
   * needs translating.
   */
  "locale.changed": "Language changed to {language}",

  // ── Route titles ────────────────────────────────────────────────────────
  "route.home.title": "Home",
  "route.dashboard.title": "Dashboard",
  "route.about.title": "About",
  "route.login.title": "Sign in",
  "route.oauthCallback.title": "Signing in",
  "route.notFound.title": "Page not found",
  "route.concurrencyLab.title": "Concurrency lab",
  "route.optimisticLab.title": "Optimistic lab",
  "route.queryCacheLab.title": "Query cache lab",
  "route.useApiLab.title": "use() lab",
  "route.actionsLab.title": "Actions lab",
  "route.streamingLab.title": "Streaming Suspense lab",
  "route.navigationLab.title": "Route transition lab",
  "route.slowRoute.title": "Slow route",
  "route.headlessLab.title": "Headless lab",
  "route.keyboardLab.title": "Keyboard lab",
  "route.liveRegionsLab.title": "Live regions lab",
  "route.polymorphicLab.title": "Polymorphic lab",
  "route.renderPropsLab.title": "Render props lab",
  "route.checkoutLab.title": "Checkout lab",
  "route.dependencyInversionLab.title": "Dependency inversion lab",
  "route.workerLab.title": "Web worker lab",
  "route.infiniteScrollLab.title": "Windowed infinite scroll lab",
  "route.prefetchLab.title": "Prefetch lab",
  "route.imageLab.title": "Image lab",
  "route.errorLab.title": "Error lab",
  "route.i18nLab.title": "Internationalisation lab",

  // ── Internationalisation lab ────────────────────────────────────────────
  "i18nLab.heading": "Internationalisation",
  "i18nLab.intro":
    "Every string below comes from a catalogue, and every number and date from a formatter. Switch language in the header to see the same components in {localeCount, plural, one {# locale} other {# locales}}.",

  "i18nLab.plurals.heading": "Plurals",
  "i18nLab.plurals.explainer":
    "English has two plural forms and Arabic has six. The count below is the same number in both; the sentence is not.",
  "i18nLab.plurals.count": "Notifications",
  /*
   * The demonstration message, and the reason the lab exists.
   *
   * `=0` is an exact match and is chosen before any plural category, which is
   * what lets English say "No notifications" while Arabic keeps the `zero`
   * category it genuinely uses for grammatical agreement. Every category CLDR
   * lists for the locale must be present or `other` silently absorbs it, and
   * `other` is the one form that is right for no particular number.
   */
  "i18nLab.plurals.notifications":
    "{count, plural, =0 {No notifications} one {# notification} other {# notifications}}",
  "i18nLab.plurals.ordinal":
    "{position, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} in the queue",

  "i18nLab.numbers.heading": "Numbers",
  "i18nLab.numbers.explainer":
    "One value, four formatters. The grouping separator, the decimal separator and the digits themselves are all the locale's to choose.",
  "i18nLab.numbers.decimal": "Decimal",
  "i18nLab.numbers.percent": "Percent",
  "i18nLab.numbers.currency": "Currency",
  "i18nLab.numbers.unit": "Unit",
  /*
   * The currency is a prop on the value, never a property of the locale. See
   * the note in `locales.ts`: a locale-keyed currency converts nothing while
   * appearing to convert everything.
   */
  "i18nLab.numbers.currencyNote":
    "The amount is {amount} in both locales — a locale is not a currency.",

  "i18nLab.dates.heading": "Dates and times",
  "i18nLab.dates.explainer":
    "Named formats, declared once in `formats.ts`, so a date looks the same everywhere it appears.",
  "i18nLab.dates.short": "Short",
  "i18nLab.dates.long": "Long",
  "i18nLab.dates.time": "Time",
  "i18nLab.dates.relative": "Relative",
  "i18nLab.dates.calendarNote":
    "Arabic here uses the Gregorian calendar with Eastern Arabic-Indic digits, which is what `ar-EG` resolves to.",

  "i18nLab.lists.heading": "Lists",
  "i18nLab.lists.explainer":
    "Joining with a comma and the word “and” is English grammar, not punctuation. `Intl.ListFormat` owns it.",

  "i18nLab.direction.heading": "Direction",
  "i18nLab.direction.explainer":
    "The document is {direction, select, rtl {right-to-left} other {left-to-right}}. Nothing below sets a side: the layout uses logical properties, so it mirrors without a second stylesheet.",
  "i18nLab.direction.current": "Current direction",
  "i18nLab.direction.bidiHeading": "Bidirectional text",
  /*
   * A Latin identifier inside an Arabic sentence. Left to the browser's own
   * bidi algorithm through `<bdi>` rather than isolated with control
   * characters: an embedded LTR run adjacent to a punctuation mark is the case
   * where the algorithm's neutral-character resolution puts the full stop on
   * the wrong side, and `<bdi>` is the markup that fixes it.
   */
  "i18nLab.direction.bidiSample": "The build is tagged {tag} and deploys from {branch}.",
} as const;

/**
 * Every message id in the application.
 *
 * `FormatjsIntl.Message` is augmented with this union (see `formatjs.d.ts`), so
 * a mistyped id is a type error at every call site — `formatMessage`,
 * `<FormattedMessage>`, and the route handles.
 */
export type MessageId = keyof typeof EN_GB_MESSAGES;
