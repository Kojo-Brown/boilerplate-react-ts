import { useState, type ReactNode } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useI18n } from "@/shared/i18n/I18nProvider";
import { SUPPORTED_LOCALES } from "@/shared/i18n/locales";
import { cn } from "@/shared/lib/cn";
import type { MessageId } from "@/shared/i18n/messages";

/**
 * Everything the i18n layer does, on one page, in whichever language the header
 * is set to.
 *
 * The page is a test instrument rather than a gallery. Each panel shows a value
 * and the formatter that produced it, so switching language in the header
 * answers a question you would otherwise have to take on trust: which of these
 * strings actually came from the catalogue, and which one is a hard-coded
 * English fragment somebody left behind. A panel that does not change is the
 * bug.
 *
 * Three things it is built to make visible:
 *
 * - **Plural categories are not counts.** The table walks the counts CLDR uses
 *   to distinguish its six Arabic categories. In English most of those rows are
 *   identical and two are not; in Arabic six are distinct. A `count === 1`
 *   ternary produces the English column and nothing else, forever.
 * - **Digits belong to the locale.** `ar-EG` resolves to Eastern Arabic-Indic
 *   digits, so a number that went through `Intl.NumberFormat` and one that was
 *   interpolated as a bare string are visibly different characters here.
 * - **Direction is an attribute, not a stylesheet.** Nothing on this page names
 *   a side. The mirror happens because `<html dir>` changed.
 *
 * `docs/i18n.md` is the prose.
 */

/**
 * One count per CLDR plural category for Arabic, plus the exact-match case.
 *
 * `ar` selects `zero` at 0, `one` at 1, `two` at 2, `few` for 3–10, `many` for
 * 11–99 and `other` for 100 and up. English collapses all of it to `one` at 1
 * and `other` everywhere else, which is exactly the point of showing the same
 * numbers side by side.
 */
const PLURAL_SAMPLES = [0, 1, 2, 3, 11, 100] as const;

/** A fixed instant, so the page is the same on every visit and in every test. */
const SAMPLE_INSTANT = new Date("2026-02-04T14:30:00Z");

/** Fixed offsets, for the relative-time formatter. */
const RELATIVE_SAMPLES = [
  { value: -1, unit: "day" },
  { value: -3, unit: "hour" },
  { value: 2, unit: "week" },
] as const;

const SAMPLE_NUMBER = 1234567.891;
const SAMPLE_FRACTION = 0.4237;
const SAMPLE_AMOUNT_MINOR = 129900;

/**
 * The currency the sample price is in.
 *
 * A constant beside the amount rather than a property of the locale, which is
 * the one rule about money this layer insists on: switching language must not
 * change what something costs. See `locales.ts`.
 */
const SAMPLE_CURRENCY = "GBP";

export function I18nLabPage() {
  const intl = useIntl();
  const { locale, direction } = useI18n();
  const [notificationCount, setNotificationCount] = useState(3);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-[var(--color-fg)]">
          <FormattedMessage id="i18nLab.heading" />
        </h1>
        <p className="text-sm text-[var(--color-muted-fg)]">
          <FormattedMessage id="i18nLab.intro" values={{ localeCount: SUPPORTED_LOCALES.length }} />
        </p>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--color-muted-fg)]">
          <div className="flex gap-2">
            <dt>lang</dt>
            <dd className="font-mono text-[var(--color-fg)]" data-testid="active-locale">
              {locale}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt>
              <FormattedMessage id="i18nLab.direction.current" />
            </dt>
            <dd className="font-mono text-[var(--color-fg)]" data-testid="active-direction">
              {direction}
            </dd>
          </div>
        </dl>
      </header>

      <Panel titleId="i18nLab.plurals.heading" explainerId="i18nLab.plurals.explainer">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--color-fg)]">
            <FormattedMessage id="i18nLab.plurals.count" />
          </span>
          <input
            type="number"
            min={0}
            max={999}
            value={notificationCount}
            onChange={(event) => {
              setNotificationCount(Number(event.target.value));
            }}
            className={cn(
              "w-28 rounded-[var(--radius-sm)] border bg-[var(--color-bg)] px-2 py-1",
              "text-[var(--color-fg)] tabular-nums",
            )}
          />
        </label>

        <p className="text-base text-[var(--color-fg)]" data-testid="plural-live">
          <FormattedMessage
            id="i18nLab.plurals.notifications"
            values={{ count: notificationCount }}
          />
        </p>

        <table className="w-full text-sm">
          <caption className="sr-only">
            {intl.formatMessage({ id: "i18nLab.plurals.heading" })}
          </caption>
          <thead>
            {/*
              `text-start`, not `text-left`. In an RTL document the heading has
              to sit above the column it names, and `left` is not where that is.
            */}
            <tr className="text-start text-[var(--color-muted-fg)]">
              <th scope="col" className="pb-2 font-medium">
                #
              </th>
              <th scope="col" className="pb-2 text-start font-medium">
                <FormattedMessage id="i18nLab.plurals.heading" />
              </th>
            </tr>
          </thead>
          <tbody data-testid="plural-table">
            {PLURAL_SAMPLES.map((count) => (
              <tr key={count} className="border-t">
                <th
                  scope="row"
                  className="py-2 pe-4 text-start font-normal tabular-nums"
                  data-testid={`plural-count-${String(count)}`}
                >
                  {intl.formatNumber(count, { format: "integer" })}
                </th>
                <td className="py-2" data-testid={`plural-form-${String(count)}`}>
                  <FormattedMessage id="i18nLab.plurals.notifications" values={{ count }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="text-sm text-[var(--color-fg)]" data-testid="ordinal">
          <FormattedMessage id="i18nLab.plurals.ordinal" values={{ position: 3 }} />
        </p>
      </Panel>

      <Panel titleId="i18nLab.numbers.heading" explainerId="i18nLab.numbers.explainer">
        <Rows>
          <Row labelId="i18nLab.numbers.decimal" testId="number-decimal">
            {intl.formatNumber(SAMPLE_NUMBER, { format: "decimal" })}
          </Row>
          <Row labelId="i18nLab.numbers.percent" testId="number-percent">
            {intl.formatNumber(SAMPLE_FRACTION, { format: "percent" })}
          </Row>
          <Row labelId="i18nLab.numbers.currency" testId="number-currency">
            {intl.formatNumber(SAMPLE_AMOUNT_MINOR / 100, {
              style: "currency",
              currency: SAMPLE_CURRENCY,
            })}
          </Row>
          <Row labelId="i18nLab.numbers.unit" testId="number-unit">
            {intl.formatNumber(96, { style: "unit", unit: "kilometer-per-hour" })}
          </Row>
        </Rows>
        <p className="text-xs text-[var(--color-muted-fg)]">
          <FormattedMessage
            id="i18nLab.numbers.currencyNote"
            values={{
              amount: intl.formatNumber(SAMPLE_AMOUNT_MINOR / 100, {
                style: "currency",
                currency: SAMPLE_CURRENCY,
              }),
            }}
          />
        </p>
      </Panel>

      <Panel titleId="i18nLab.dates.heading" explainerId="i18nLab.dates.explainer">
        <Rows>
          <Row labelId="i18nLab.dates.short" testId="date-short">
            {intl.formatDate(SAMPLE_INSTANT, { format: "short" })}
          </Row>
          <Row labelId="i18nLab.dates.long" testId="date-long">
            {intl.formatDate(SAMPLE_INSTANT, { format: "long" })}
          </Row>
          <Row labelId="i18nLab.dates.time" testId="date-time">
            {intl.formatTime(SAMPLE_INSTANT, { format: "short" })}
          </Row>
          <Row labelId="i18nLab.dates.relative" testId="date-relative">
            {/*
              Joined with `formatList`, not with a literal separator. The three
              samples are a list of phrases, and how a list is punctuated is the
              locale's answer — which is the same argument the Lists panel below
              makes, applied to the page's own presentation rather than to its
              content.
            */}
            {intl.formatList(
              RELATIVE_SAMPLES.map(({ value, unit }) =>
                intl.formatRelativeTime(value, unit, { numeric: "auto" }),
              ),
              { type: "unit" },
            )}
          </Row>
        </Rows>
        <p className="text-xs text-[var(--color-muted-fg)]">
          <FormattedMessage id="i18nLab.dates.calendarNote" />
        </p>
      </Panel>

      <Panel titleId="i18nLab.lists.heading" explainerId="i18nLab.lists.explainer">
        <p className="text-sm text-[var(--color-fg)]" data-testid="list-formatted">
          {intl.formatList(
            SUPPORTED_LOCALES.map((descriptor) => descriptor.endonym),
            { type: "conjunction" },
          )}
        </p>
      </Panel>

      <Panel titleId="i18nLab.direction.heading" explainerId="i18nLab.direction.explainer">
        {/*
          The explainer takes the direction as a `select` argument rather than
          two messages, so a translator sees both branches of the sentence
          together. `Panel` passes it through.
        */}
        <h3 className="text-sm font-medium text-[var(--color-fg)]">
          <FormattedMessage id="i18nLab.direction.bidiHeading" />
        </h3>
        <p className="text-sm text-[var(--color-fg)]" data-testid="bidi-sample">
          {/*
            `<bdi>` around each Latin value, and it is not decoration. A
            left-to-right run inside a right-to-left sentence ends at a
            neutral character — the full stop — whose direction the Unicode
            bidi algorithm resolves from its surroundings, and the result is a
            sentence that ends in the middle of itself. `<bdi>` isolates the
            run so the punctuation stays with the sentence rather than with the
            identifier.
          */}
          <FormattedMessage
            id="i18nLab.direction.bidiSample"
            values={{
              tag: <bdi className="font-mono">v2.14.0-rc.3</bdi>,
              branch: <bdi className="font-mono">release/2026-02</bdi>,
            }}
          />
        </p>
      </Panel>
    </div>
  );
}

function Panel({
  titleId,
  explainerId,
  children,
}: {
  readonly titleId: MessageId;
  readonly explainerId: MessageId;
  readonly children: ReactNode;
}) {
  const { direction } = useI18n();

  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-md)] border p-4",
        "bg-[var(--color-surface)]",
      )}
    >
      <h2 className="text-lg font-semibold text-[var(--color-fg)]">
        <FormattedMessage id={titleId} />
      </h2>
      {/*
        `direction` is passed to every panel's explainer, and only the Direction
        panel's message has a `{direction, select, …}` branch for it. react-intl
        ignores a value an ICU string does not name, which is what makes one
        `Panel` able to host messages of differing arity — and is why the
        alternative (a second `PanelWithDirection`) would be a component that
        exists to satisfy a type rather than to render anything different.
      */}
      <p className="text-sm text-[var(--color-muted-fg)]">
        <FormattedMessage id={explainerId} values={{ direction }} />
      </p>
      {children}
    </section>
  );
}

function Rows({ children }: { readonly children: ReactNode }) {
  return <dl className="flex flex-col gap-2 text-sm">{children}</dl>;
}

function Row({
  labelId,
  testId,
  children,
}: {
  readonly labelId: MessageId;
  readonly testId: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <dt className="w-32 shrink-0 text-[var(--color-muted-fg)]">
        <FormattedMessage id={labelId} />
      </dt>
      <dd className="font-mono text-[var(--color-fg)]" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}
