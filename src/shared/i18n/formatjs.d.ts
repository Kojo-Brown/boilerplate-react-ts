import type { MessageId } from "@/shared/i18n/messages/en-GB";
import type { LocaleTag } from "@/shared/i18n/locales";
import type { DateFormatName, NumberFormatName, TimeFormatName } from "@/shared/i18n/formats";

/**
 * react-intl's type hooks, filled in with this application's own vocabulary.
 *
 * `@formatjs/intl` declares `FormatjsIntl` as a global namespace of empty
 * interfaces and reads them back through conditional types that fall open to
 * `string` when they are empty. Declaring them here narrows every call site in
 * the program at once — there is no import to remember and no wrapper to route
 * calls through, which is what makes it hold: a `formatMessage` written by
 * somebody who has never opened this file is still checked.
 *
 * Three of the five hooks are filled in. The two that are not:
 *
 * **`MessageArguments`** would type each message's placeholder values, so
 * `formatMessage({ id: "route.announcement" })` with no `page` would fail to
 * compile. It is left empty because the values cannot be *derived*: v12 infers
 * them only from `defineMessages<V>(…, { typed: true })`, where `V` is written
 * out by hand, and feeding that back through
 * `MessageArgumentsFromCatalog<typeof catalog>` is a type cycle — the catalogue's
 * own ids are checked against `Message.ids`, which would then be
 * `keyof MessageArguments`, which is derived from the catalogue. TypeScript
 * reports it as "recursively references itself as a base type" and the whole
 * namespace collapses to `any`. Hand-writing the argument shapes instead would
 * make every placeholder a second source of truth beside the ICU string that
 * already declares it, and a second source of truth about placeholders is the
 * thing this layer is for avoiding. What catches a missing value is the
 * provider's `onError`, which `I18nProvider` turns into a thrown error outside
 * production — so it fails a test rather than a customer.
 *
 * **`MessageFormatting.brandedText`** would make formatted output a nominal
 * type that cannot be concatenated. Attractive, and rejected for now: it
 * changes the return type of every formatter in the program, which is a
 * migration rather than a setting.
 */
declare global {
  namespace FormatjsIntl {
    interface Message {
      ids: MessageId;
    }

    interface IntlConfig {
      locale: LocaleTag;
    }

    interface Formats {
      date: DateFormatName;
      time: TimeFormatName;
      number: NumberFormatName;
    }
  }
}
