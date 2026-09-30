import { useId, type ChangeEvent } from "react";
import { useIntl } from "react-intl";
import { cn } from "@/shared/lib/cn";
import { useI18n } from "@/shared/i18n/I18nProvider";
import { isSupportedLocale } from "@/shared/i18n/locales";

export interface LocaleSwitcherProps {
  readonly className?: string | undefined;
}

/**
 * The language switcher.
 *
 * ## Why a native `<select>` and not this repository's `SelectMenu`
 *
 * `SelectMenu` is the better control for a long list, a searchable list, or
 * options that need rich content. This is none of those: a fixed, short set of
 * plain strings, which is the case the platform control wins outright.
 *
 * - It is the one widget a phone renders as its own native picker, and this is
 *   the control a reader who has landed on the wrong language most needs to
 *   find on a phone.
 * - Its keyboard behaviour, its accessible name, its announcement on change and
 *   its own direction handling are the operating system's, not something this
 *   codebase has to keep correct — and "correct" here includes typing the first
 *   letter of a language name in a script that is not the UI language.
 * - It cannot be rendered half-open, focus-trapped, or left open across a
 *   route change, which are the three ways a hand-built popup regresses.
 *
 * ## Why each option is in its own language
 *
 * The labels come from `endonym`, never from the catalogue. A reader looking for
 * Arabic is, by definition, someone who may not be able to read the current UI
 * language — so "Arabic" in English is the one label that fails exactly the
 * person using the control. `lang` and `dir` are set per `<option>` so a
 * right-to-left name renders as itself inside a left-to-right list.
 */
export function LocaleSwitcher({ className }: LocaleSwitcherProps) {
  const intl = useIntl();
  const { locale, locales, setLocale, isSwitching } = useI18n();
  const labelId = useId();

  const handleChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const next = event.target.value;
    /*
     * The narrowing is not ceremony. `HTMLSelectElement.value` is a `string`,
     * and it is a string that arrives from the DOM — an extension, a userscript
     * or a restored form state can hand over a value no `<option>` above ever
     * offered, and `loadCatalog` would then index a record with a key it does
     * not hold and call `undefined`.
     */
    if (isSupportedLocale(next)) setLocale(next);
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/*
        A real `<label>`, visually hidden rather than replaced by an
        `aria-label`. The element is what associates the name with the control
        for every consumer at once — screen readers, voice control ("click
        Language"), and a click on the label moving focus into the select — and
        an `aria-label` only ever satisfies the first of those.
      */}
      <label id={labelId} htmlFor={`${labelId}-select`} className="sr-only">
        {intl.formatMessage({ id: "locale.label" })}
      </label>
      <select
        id={`${labelId}-select`}
        value={locale}
        onChange={handleChange}
        /*
          Disabled while a catalogue loads. Not to prevent a race — a second
          switch would resolve correctly, since each `setLocale` awaits its own
          catalogue and commits it whole — but because the control would
          otherwise show a language the page is not in yet, and a reader who
          sees no change follows it with a second click.
        */
        disabled={isSwitching}
        className={cn(
          "h-9 rounded-[var(--radius-sm)] border bg-[var(--color-bg)] px-2",
          "text-sm text-[var(--color-fg)]",
          "hover:bg-[var(--color-muted)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2",
          "focus-visible:outline-[var(--color-primary)]",
          "disabled:cursor-progress disabled:opacity-60",
        )}
      >
        {locales.map((option) => (
          <option key={option.tag} value={option.tag} lang={option.tag} dir={option.dir}>
            {option.endonym}
          </option>
        ))}
      </select>
      {/*
        The pending state as text as well as a disabled control, for the reader
        who cannot see that the control greyed out. Not a live region: the
        switch was initiated by this reader, the announcement of its *completion*
        is the route announcer's job, and a region here would speak over it.
      */}
      {isSwitching && (
        <span className="text-xs text-[var(--color-muted-fg)]" data-testid="locale-pending">
          {intl.formatMessage({ id: "locale.pending" })}
        </span>
      )}
    </div>
  );
}
