import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefCallback } from "react";
import {
  mergeProps,
  type MergedProps,
  type NoCallerProps,
  type PropsRecord,
} from "@/shared/lib/mergeProps";

/**
 * A single-select listbox with no opinion about what it looks like.
 *
 * Everything here is behaviour: which option is selected, which one virtual
 * focus is on, what the arrow keys and typeahead do, and the ARIA attributes
 * that make those things legible to a screen reader. Nothing here renders, and
 * nothing here decides on a colour, a border, a popup or an animation.
 *
 * The split is not cosmetic. `useListbox.test.tsx` drives the whole state
 * machine through `renderHook`, with no markup at all, and
 * `listboxSkins.test.tsx` runs one shared behaviour suite against two
 * presentations — an always-visible list and a popup menu — that have no JSX
 * in common. A component that bundles behaviour with markup can only ever be
 * tested through whichever DOM it happens to render.
 *
 * See `docs/headless-components.md`.
 */

export interface ListboxOption<TValue extends string> {
  value: TValue;
  /** Visible text. Typeahead matches against this, so it is not optional. */
  label: string;
  disabled?: boolean | undefined;
}

export interface UseListboxBaseOptions<TValue extends string> {
  options: readonly ListboxOption<TValue>[];
  /** Accessible name for the listbox. A listbox without one is an unnamed group. */
  label: string;
  /**
   * Called when the user commits a choice with Enter, Space or a click, and
   * when Escape asks to abandon one.
   *
   * This is the whole of the hook's knowledge about popups: a skin with
   * something to close passes a closer, an always-visible skin does not.
   */
  onRequestClose?: (() => void) | undefined;
  /** How long a typeahead buffer survives between keystrokes. */
  typeaheadTimeoutMs?: number | undefined;
}

/**
 * Controlled and uncontrolled are two shapes rather than one shape with
 * optional halves, for the same reason as `createTabs` — it makes `value`
 * without `onValueChange` (a listbox that visibly ignores clicks) and `value`
 * alongside `defaultValue` (the default silently discarded) unwritable.
 *
 * Exported separately so a presentation can offer the same choice without
 * restating the union. A skin's props are then
 * `{ …presentation } & ListboxValueProps<TValue>`, which stays assignable to
 * the hook's argument, so the skin forwards `props` whole rather than picking
 * the pair apart — object rest would flatten the union and lose the
 * correlation between `value` and `onValueChange` that the two shapes exist
 * to state.
 */
export type ListboxValueProps<TValue extends string> =
  | {
      value: TValue | null;
      onValueChange: (value: TValue) => void;
      defaultValue?: undefined;
    }
  | {
      defaultValue?: TValue | null | undefined;
      onValueChange?: ((value: TValue) => void) | undefined;
      value?: undefined;
    };

export type UseListboxOptions<TValue extends string> = UseListboxBaseOptions<TValue> &
  ListboxValueProps<TValue>;

/**
 * Props for the element carrying `role="listbox"`.
 *
 * A `type` rather than an `interface` on purpose: only a type alias gets an
 * implicit index signature, and without one it does not satisfy the
 * `Record<string, unknown>` constraint `mergeProps` is written against.
 */
export type ListboxElementProps = {
  id: string;
  role: "listbox";
  tabIndex: number;
  "aria-label": string;
  "aria-activedescendant": string | undefined;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  ref: RefCallback<HTMLElement>;
};

/** Props for one element carrying `role="option"`. */
export type ListboxOptionElementProps = {
  id: string;
  role: "option";
  "aria-selected": boolean;
  "aria-disabled": true | undefined;
  /** Styling hook for the virtually focused option; it is not `:focus`. */
  "data-active": "" | undefined;
  onClick: () => void;
};

export interface UseListboxResult<TValue extends string> {
  listboxId: string;
  selectedValue: TValue | null;
  selectedOption: ListboxOption<TValue> | null;
  /** The option virtual focus sits on. Not necessarily the selected one. */
  activeValue: TValue | null;
  activeOption: ListboxOption<TValue> | null;
  optionId: (value: TValue) => string;
  select: (value: TValue) => void;
  setActiveValue: (value: TValue | null) => void;
  /** Moves virtual focus to the selected option, or to the first enabled one. */
  activateInitialOption: () => void;
  getListboxProps: <TCaller extends PropsRecord = NoCallerProps>(
    callerProps?: TCaller,
  ) => MergedProps<ListboxElementProps, TCaller>;
  getOptionProps: <TCaller extends PropsRecord = NoCallerProps>(
    value: TValue,
    callerProps?: TCaller,
  ) => MergedProps<ListboxOptionElementProps, TCaller>;
}

/** APG's listbox pattern stops at the ends; only a tablist wraps. */
const STEP_KEYS: Record<string, 1 | -1 | undefined> = {
  ArrowDown: 1,
  ArrowUp: -1,
};

export const DEFAULT_TYPEAHEAD_TIMEOUT_MS = 500;

function isPrintableCharacter(key: string): boolean {
  return key.length === 1 && key !== " ";
}

/**
 * Finds the option a typeahead buffer points at, starting the search *after*
 * the current position so repeated matches advance.
 *
 * A buffer of one repeated character ("aaa") cycles through the options
 * starting with that character rather than looking for an option literally
 * called "aaa" — the APG behaviour, and the only way to reach the second
 * "Argentina" in a list that has two.
 */
export function findTypeaheadMatch<TValue extends string>(
  options: readonly ListboxOption<TValue>[],
  buffer: string,
  fromValue: TValue | null,
): ListboxOption<TValue> | null {
  if (buffer === "") return null;

  const allSameCharacter = buffer === buffer[0]?.repeat(buffer.length);
  const needle = (allSameCharacter ? (buffer[0] ?? "") : buffer).toLowerCase();

  const startIndex = fromValue === null ? -1 : options.findIndex((o) => o.value === fromValue);
  // A multi-character buffer keeps refining the option it already landed on,
  // so it re-tests the current one first. A repeated single character is
  // asking for the *next* match and must not.
  const offset = allSameCharacter ? 1 : 0;

  for (let step = offset; step < options.length + offset; step += 1) {
    const option = options[(startIndex + step + options.length) % options.length];
    if (!option || option.disabled === true) continue;
    if (option.label.toLowerCase().startsWith(needle)) return option;
  }
  return null;
}

export function useListbox<TValue extends string>(
  options: UseListboxOptions<TValue>,
): UseListboxResult<TValue> {
  const {
    options: items,
    label,
    onRequestClose,
    typeaheadTimeoutMs = DEFAULT_TYPEAHEAD_TIMEOUT_MS,
    value: controlledValue,
    defaultValue = null,
    onValueChange,
  } = options;

  const baseId = useId();
  const [uncontrolledValue, setUncontrolledValue] = useState<TValue | null>(defaultValue);
  const [activeValueState, setActiveValueState] = useState<TValue | null>(null);

  const listRef = useRef<HTMLElement | null>(null);
  const typeaheadBuffer = useRef("");
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isControlled = controlledValue !== undefined;
  const selectedValue = isControlled ? controlledValue : uncontrolledValue;

  const enabledOptions = items.filter((option) => option.disabled !== true);

  /**
   * Virtual focus is re-derived from the live options on every render rather
   * than trusted from state.
   *
   * `aria-activedescendant` is an IDREF, and an option that has been filtered
   * out or disabled since it was activated no longer has an element to point
   * at. Left alone the attribute keeps naming an id that is not in the
   * document — which assistive technology reports as a broken relationship,
   * and which nothing in a screenshot would show.
   */
  const activeOption = enabledOptions.find((option) => option.value === activeValueState) ?? null;
  const activeValue = activeOption?.value ?? null;
  const selectedOption = items.find((option) => option.value === selectedValue) ?? null;

  const optionId = useCallback((value: TValue): string => `${baseId}-option-${value}`, [baseId]);

  const clearTypeahead = useCallback((): void => {
    typeaheadBuffer.current = "";
    if (typeaheadTimer.current !== null) {
      clearTimeout(typeaheadTimer.current);
      typeaheadTimer.current = null;
    }
  }, []);

  // A pending typeahead timer outlives the component that scheduled it.
  useEffect(() => clearTypeahead, [clearTypeahead]);

  /**
   * Virtual focus moves without the browser's help.
   *
   * With a roving tab stop the browser scrolls the newly focused element into
   * view for free. `aria-activedescendant` never moves real focus — that is
   * the point of it — so nothing scrolls, and arrowing past the fold walks the
   * highlight off the bottom of a scrollable list with the page perfectly
   * still. Doing it here is why the hook needs a ref of its own, and therefore
   * why `getListboxProps` has to merge the caller's ref instead of setting one.
   */
  useEffect(() => {
    if (activeValue === null) return;
    const element = listRef.current?.ownerDocument.getElementById(optionId(activeValue));
    // jsdom implements no layout and so ships no `scrollIntoView`; a real
    // browser always has it.
    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [activeValue, optionId]);

  const select = useCallback(
    (value: TValue): void => {
      if (!isControlled) setUncontrolledValue(value);
      onValueChange?.(value);
    },
    [isControlled, onValueChange],
  );

  const setActiveValue = useCallback((value: TValue | null): void => {
    setActiveValueState(value);
  }, []);

  const activateInitialOption = useCallback((): void => {
    setActiveValueState((current) => {
      const enabled = items.filter((option) => option.disabled !== true);
      return (
        enabled.find((option) => option.value === current)?.value ??
        enabled.find((option) => option.value === selectedValue)?.value ??
        enabled[0]?.value ??
        null
      );
    });
  }, [items, selectedValue]);

  const commit = (value: TValue): void => {
    select(value);
    onRequestClose?.();
  };

  const moveActiveBy = (step: 1 | -1): void => {
    if (enabledOptions.length === 0) return;
    const currentIndex = enabledOptions.findIndex((option) => option.value === activeValue);
    // No wrapping: a listbox that jumps from the last option back to the first
    // makes "am I at the end?" unanswerable without counting.
    const nextIndex =
      currentIndex === -1
        ? step === 1
          ? 0
          : enabledOptions.length - 1
        : Math.min(enabledOptions.length - 1, Math.max(0, currentIndex + step));
    setActiveValueState(enabledOptions[nextIndex]?.value ?? null);
  };

  const handleTypeahead = (character: string): void => {
    typeaheadBuffer.current += character;
    if (typeaheadTimer.current !== null) clearTimeout(typeaheadTimer.current);
    typeaheadTimer.current = setTimeout(() => {
      typeaheadBuffer.current = "";
      typeaheadTimer.current = null;
    }, typeaheadTimeoutMs);

    const match = findTypeaheadMatch(items, typeaheadBuffer.current, activeValue);
    if (match) setActiveValueState(match.value);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    const step = STEP_KEYS[event.key];
    if (step !== undefined) {
      event.preventDefault();
      moveActiveBy(step);
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const target = event.key === "Home" ? enabledOptions[0] : enabledOptions.at(-1);
      if (target) setActiveValueState(target.value);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (activeValue !== null) commit(activeValue);
      return;
    }

    if (event.key === " ") {
      event.preventDefault();
      /*
       * Space is two keys wearing one hat. With no typeahead in flight it
       * commits the active option; mid-search it is a space *in the search*,
       * because "New " is how you get past "New Hampshire" to "New York".
       * Committing unconditionally makes every multi-word label unreachable by
       * typing, and the symptom is a listbox that closes at random.
       */
      if (typeaheadBuffer.current !== "") {
        handleTypeahead(" ");
      } else if (activeValue !== null) {
        commit(activeValue);
      }
      return;
    }

    if (event.key === "Escape") {
      clearTypeahead();
      onRequestClose?.();
      return;
    }

    if (isPrintableCharacter(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      handleTypeahead(event.key);
    }
  };

  const setListRef = useCallback<RefCallback<HTMLElement>>((node) => {
    listRef.current = node;
  }, []);

  const getListboxProps = <TCaller extends PropsRecord = NoCallerProps>(
    callerProps?: TCaller,
  ): MergedProps<ListboxElementProps, TCaller> =>
    mergeProps<ListboxElementProps, TCaller>(
      {
        id: baseId,
        role: "listbox",
        // The listbox is one tab stop; the arrow keys move within it.
        tabIndex: 0,
        "aria-label": label,
        "aria-activedescendant": activeValue === null ? undefined : optionId(activeValue),
        onKeyDown: handleKeyDown,
        onFocus: activateInitialOption,
        // A buffer that survives the listbox losing focus turns the next
        // visit's first keystroke into a continuation of a forgotten search.
        onBlur: clearTypeahead,
        ref: setListRef,
      },
      callerProps,
    );

  const getOptionProps = <TCaller extends PropsRecord = NoCallerProps>(
    value: TValue,
    callerProps?: TCaller,
  ): MergedProps<ListboxOptionElementProps, TCaller> => {
    const option = items.find((candidate) => candidate.value === value);
    if (!option) {
      // Rendering an option the hook does not know about is not a cosmetic
      // slip: it can never be reached by keyboard, never matched by typeahead,
      // and `aria-activedescendant` can never name it.
      throw new Error(`useListbox: no option with value "${value}"`);
    }
    const disabled = option.disabled === true;

    return mergeProps<ListboxOptionElementProps, TCaller>(
      {
        id: optionId(value),
        role: "option",
        "aria-selected": selectedValue === value,
        "aria-disabled": disabled ? true : undefined,
        "data-active": activeValue === value ? "" : undefined,
        onClick: () => {
          if (disabled) return;
          setActiveValueState(value);
          commit(value);
        },
      },
      callerProps,
    );
  };

  return {
    listboxId: baseId,
    selectedValue,
    selectedOption,
    activeValue,
    activeOption,
    optionId,
    select,
    setActiveValue,
    activateInitialOption,
    getListboxProps,
    getOptionProps,
  };
}
