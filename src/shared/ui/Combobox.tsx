import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/shared/lib/cn";
import { filterOptions } from "@/shared/lib/filterOptions";
import type { ListboxOption } from "@/shared/hooks/useListbox";

/**
 * The APG combobox pattern, list-autocomplete flavour: a text field that
 * filters a list of values and commits one of them.
 *
 * The third control in this repository whose popup is a `role="listbox"`, and
 * the third set of keyboard rules, because what the user is doing with the
 * keyboard is different in each. `OptionList`/`SelectMenu` own their keys
 * outright — every printable character is a typeahead. `Menu` owns them too
 * and moves real focus between commands. A combobox owns almost none of them:
 * focus never leaves the textbox, the printable keys belong to *text editing*,
 * and the component may only claim the ones editing does not want.
 *
 * That constraint is the source of every decision here worth stating:
 *
 * - **Home and End are not list keys.** They are the two keys a keyboard user
 *   reaches for to get to the start or the end of what they have typed, and a
 *   combobox that steals them to jump to the first or last option breaks text
 *   editing in a field that exists to be typed in. The listbox and the menu
 *   both bind them; this does not, and the popup is navigated with the arrows
 *   alone. (APG binds Home/End in *select-only* comboboxes, where there is no
 *   text to move through — this is the editable one.)
 * - **`aria-activedescendant` on the textbox, not a roving tab stop.** Moving
 *   real focus into the popup would take it out of the field the user is
 *   typing into, which is the one thing a combobox cannot do. It is the same
 *   mechanism `useListbox` uses and the same cost — nothing scrolls on its
 *   own, so the effect below does it by hand.
 * - **`aria-selected` follows the *active* option, not the committed value.**
 *   This reads backwards next to `OptionList`, where it marks the chosen one,
 *   and it is what the combobox pattern specifies: the popup is a transient
 *   list of candidates rather than a display of state, and "selected" there
 *   means "the one Enter would take". The committed value is already on screen
 *   — it is the text in the box.
 * - **Escape has two jobs, in order.** With the popup open it closes it and
 *   leaves the text alone; with the popup closed it clears the field. Binding
 *   it to "clear" unconditionally means a user dismissing a popup they did not
 *   want also loses what they typed.
 */

export interface ComboboxProps<TValue extends string> {
  options: readonly ListboxOption<TValue>[];
  /** Accessible name for the textbox and for the popup it controls. */
  label: string;
  value: TValue | null;
  onValueChange: (value: TValue | null) => void;
  placeholder?: string | undefined;
  className?: string | undefined;
}

export function Combobox<TValue extends string>({
  options,
  label,
  value,
  onValueChange,
  placeholder,
  className,
}: ComboboxProps<TValue>): ReactNode {
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const emptyId = `${baseId}-empty`;

  const selectedOption = options.find((option) => option.value === value) ?? null;

  const [query, setQuery] = useState(selectedOption?.label ?? "");
  const [isOpen, setIsOpen] = useState(false);
  const [activeValue, setActiveValue] = useState<TValue | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const optionId = useCallback(
    (optionValue: TValue): string => `${baseId}-option-${optionValue}`,
    [baseId],
  );

  /**
   * The committed value is the caller's; the text in the box is this
   * component's. They meet here, and only when the *value* moves.
   *
   * The obvious spelling — re-deriving the text from `value` on every render —
   * makes the field unusable, because every keystroke would be overwritten by
   * the label of whatever is still committed. The equally obvious fix, never
   * syncing at all, leaves the box showing a stale label forever the first
   * time something outside this component sets the value: a "clear filters"
   * button elsewhere on the page resets the state and the combobox goes on
   * displaying the old choice, with nothing anywhere to suggest it is lying.
   *
   * So the ref, not the dependency array, is what decides. `selectedLabel` is
   * a dependency because the effect reads it, but a relabelled option with the
   * same value must not clobber what the user is typing, and the guard is what
   * stops it.
   */
  const selectedLabel = selectedOption?.label ?? "";
  const lastSyncedValue = useRef(value);
  useEffect(() => {
    if (lastSyncedValue.current === value) return;
    lastSyncedValue.current = value;
    setQuery(selectedLabel);
  }, [value, selectedLabel]);

  const matches = useMemo(() => filterOptions(options, query), [options, query]);
  const enabledMatches = useMemo(
    () => matches.filter((option) => option.disabled !== true),
    [matches],
  );

  /**
   * Virtual focus is re-derived from the *current* matches rather than trusted
   * from state, for the reason `useListbox` spells out at length: an
   * `aria-activedescendant` naming an option that a keystroke has just
   * filtered out of the list is a broken IDREF, and nothing on screen shows
   * it. A combobox meets that case on almost every keystroke, where a listbox
   * meets it only when its options change underneath it.
   */
  const activeOption = enabledMatches.find((option) => option.value === activeValue) ?? null;
  const resolvedActiveValue = activeOption?.value ?? null;

  const hasNoMatches = query.trim() !== "" && matches.length === 0;
  // A popup with nothing in it is not something to show or to point
  // `aria-controls` at; the empty state below carries the news instead.
  const isExpanded = isOpen && matches.length > 0;

  useEffect(() => {
    if (resolvedActiveValue === null) return;
    const element = inputRef.current?.ownerDocument.getElementById(optionId(resolvedActiveValue));
    // jsdom implements no layout and so ships no `scrollIntoView`; a real
    // browser always has it.
    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [resolvedActiveValue, optionId]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target) === true) return;
      setIsOpen(false);
      setActiveValue(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [isOpen]);

  const commit = (option: ListboxOption<TValue>): void => {
    onValueChange(option.value);
    setQuery(option.label);
    setIsOpen(false);
    setActiveValue(null);
  };

  const moveActiveBy = (step: 1 | -1): void => {
    if (enabledMatches.length === 0) return;
    const currentIndex = enabledMatches.findIndex((option) => option.value === resolvedActiveValue);
    // No wrapping, matching `useListbox` and for its reason: this popup is a
    // set of candidates the user is looking through, and a list that jumps
    // from the bottom back to the top makes "have I seen them all?"
    // unanswerable without counting.
    const nextIndex =
      currentIndex === -1
        ? step === 1
          ? 0
          : enabledMatches.length - 1
        : Math.min(enabledMatches.length - 1, Math.max(0, currentIndex + step));
    setActiveValue(enabledMatches[nextIndex]?.value ?? null);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        /*
         * Alt+ArrowDown opens the popup and stops there; plain ArrowDown opens
         * it *and* moves onto the first candidate. The distinction is APG's and
         * it is the difference between "show me what is there" and "give me the
         * first one", which are different intentions and are one keystroke
         * apart. Opening always onto the first option makes the former
         * impossible; opening never onto it costs the latter an extra key.
         */
        if (!event.altKey) moveActiveBy(1);
        return;
      }
      moveActiveBy(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (event.altKey) {
        // The mirror of Alt+ArrowDown: dismiss the popup, keep the text.
        setIsOpen(false);
        setActiveValue(null);
        return;
      }
      if (!isOpen) {
        setIsOpen(true);
        moveActiveBy(-1);
        return;
      }
      moveActiveBy(-1);
      return;
    }

    if (event.key === "Enter") {
      if (activeOption) {
        event.preventDefault();
        commit(activeOption);
        return;
      }
      if (isOpen) {
        // Nothing is highlighted, so there is nothing to commit — but the
        // popup is over a form and Enter would submit it, which is not what
        // "I am part-way through choosing something" means.
        event.preventDefault();
        setIsOpen(false);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      if (isOpen) {
        setIsOpen(false);
        setActiveValue(null);
        return;
      }
      // Only once the popup is out of the way — see the note at the top.
      setQuery("");
      onValueChange(null);
      return;
    }

    if (event.key === "Tab") {
      /*
       * Not prevented: Tab's job is to leave. What it does on the way out is
       * commit the highlighted candidate, because arrowing onto an option is
       * the user saying "this one" and leaving the field with the text still
       * reading something they did not choose is the worse of the two
       * surprises. With nothing highlighted it commits nothing.
       */
      if (activeOption) commit(activeOption);
      setIsOpen(false);
      setActiveValue(null);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      <label htmlFor={`${baseId}-input`} className="mb-1 block text-sm text-[var(--color-fg)]">
        {label}
      </label>
      <div className="flex">
        <input
          ref={inputRef}
          id={`${baseId}-input`}
          type="text"
          role="combobox"
          // `list` autocomplete, not `both`: nothing is ever typed into the
          // field on the user's behalf. Claiming `both` while the value is
          // never completed inline tells a screen-reader user to expect a
          // selection they will never find.
          aria-autocomplete="list"
          aria-expanded={isExpanded}
          aria-controls={isExpanded ? listboxId : undefined}
          aria-activedescendant={
            resolvedActiveValue === null ? undefined : optionId(resolvedActiveValue)
          }
          aria-describedby={hasNoMatches ? emptyId : undefined}
          autoComplete="off"
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
            /*
             * Typing clears the highlight rather than moving it to the first
             * match. A highlight that follows the filter means Enter commits
             * whatever happens to be at the top at the moment the user finishes
             * typing — which changes under them between keystrokes, and turns a
             * fast typist's Enter into a selection they never looked at.
             */
            setActiveValue(null);
          }}
          onKeyDown={handleKeyDown}
          className={cn(
            "h-10 min-w-56 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-fg)]",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
          )}
        />
      </div>

      {hasNoMatches ? (
        /*
         * Not a live region, deliberately. `role="status"` here would be the
         * obvious reach and it belongs to the next spec item, which is about
         * announcing async status as a system rather than one control at a
         * time. For now the field points at it with `aria-describedby`, so the
         * news arrives when focus is in the box — which, in a combobox, is
         * always.
         */
        <p id={emptyId} className="mt-1 text-sm text-[var(--color-muted-fg)]">
          No matches for “{query.trim()}”
        </p>
      ) : null}

      {isExpanded ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={label}
          className={cn(
            "absolute z-10 mt-1 flex max-h-64 min-w-56 flex-col overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-lg",
          )}
        >
          {matches.map((option) => {
            const disabled = option.disabled === true;
            const isActive = resolvedActiveValue === option.value;
            return (
              <li
                key={option.value}
                id={optionId(option.value)}
                role="option"
                // Follows the highlight, not the committed value — see the
                // note at the top of the file.
                aria-selected={isActive}
                aria-disabled={disabled ? true : undefined}
                data-active={isActive ? "" : undefined}
                // `mousedown` rather than `click`: a click on an option blurs
                // the textbox first, and a blur handler that closes the popup
                // would unmount this element before its click ever lands.
                onMouseDown={(event) => {
                  event.preventDefault();
                  if (disabled) return;
                  commit(option);
                  inputRef.current?.focus();
                }}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm",
                  "data-[active]:bg-[var(--color-muted)]",
                  value === option.value
                    ? "font-medium text-[var(--color-fg)]"
                    : "text-[var(--color-fg-subtle)]",
                  disabled && "cursor-not-allowed opacity-50",
                )}
              >
                <span>{option.label}</span>
                {value === option.value ? (
                  <span aria-hidden="true" className="text-[var(--color-primary-strong)]">
                    ✓
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
