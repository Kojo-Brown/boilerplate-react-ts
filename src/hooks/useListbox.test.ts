import { describe, it, expect, vi, afterEach, type Mock } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  findTypeaheadMatch,
  useListbox,
  type ListboxOption,
  type UseListboxOptions,
} from "./useListbox";

/*
 * Not one line of JSX in this file, and that is the claim the headless split
 * is making: the whole state machine — selection, virtual focus, arrow keys,
 * typeahead, the ARIA attributes — is reachable without rendering anything.
 * A component that owned this behaviour could only be tested through whatever
 * markup it happened to produce.
 */

type Fruit = "apple" | "apricot" | "banana" | "cherry" | "new-york";

const FRUITS: readonly ListboxOption<Fruit>[] = [
  { value: "apple", label: "Apple" },
  { value: "apricot", label: "Apricot" },
  { value: "banana", label: "Banana", disabled: true },
  { value: "cherry", label: "Cherry" },
  { value: "new-york", label: "New York" },
];

/**
 * The hook reads three things off a keyboard event — `key`, the modifier
 * flags, and `preventDefault` — so a plain object is a complete stand-in. The
 * double assertion is the price of not dragging a DOM in to press a key.
 */
function keyEvent(
  key: string,
  modifiers: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {},
): ReactKeyboardEvent<HTMLElement> & { preventDefault: Mock } {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...modifiers,
    preventDefault: vi.fn(),
  } as unknown as ReactKeyboardEvent<HTMLElement> & { preventDefault: Mock };
}

function renderListbox(options: Partial<UseListboxOptions<Fruit>> = {}) {
  return renderHook(() =>
    useListbox<Fruit>({ options: FRUITS, label: "Fruit", ...options } as UseListboxOptions<Fruit>),
  );
}

function press(
  result: { current: ReturnType<typeof useListbox<Fruit>> },
  key: string,
  modifiers?: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean },
): ReactKeyboardEvent<HTMLElement> & { preventDefault: Mock } {
  const event = keyEvent(key, modifiers);
  act(() => {
    result.current.getListboxProps().onKeyDown(event);
  });
  return event;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useListbox — selection", () => {
  it("starts unselected and selects what defaultValue names", () => {
    expect(renderListbox().result.current.selectedValue).toBeNull();
    expect(renderListbox({ defaultValue: "cherry" }).result.current.selectedValue).toBe("cherry");
  });

  it("owns the value when uncontrolled and reports every change", () => {
    const onValueChange = vi.fn();
    const { result } = renderListbox({ onValueChange });

    act(() => {
      result.current.select("apricot");
    });

    expect(result.current.selectedValue).toBe("apricot");
    expect(result.current.selectedOption?.label).toBe("Apricot");
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith("apricot");
  });

  it("only reports when controlled — the owner decides what happens next", () => {
    const onValueChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }: { value: Fruit | null }) =>
        useListbox<Fruit>({ options: FRUITS, label: "Fruit", value, onValueChange }),
      { initialProps: { value: "apple" as Fruit | null } },
    );

    act(() => {
      result.current.select("cherry");
    });

    expect(onValueChange).toHaveBeenCalledExactlyOnceWith("cherry");
    expect(result.current.selectedValue).toBe("apple");

    rerender({ value: "cherry" });
    expect(result.current.selectedValue).toBe("cherry");
  });
});

describe("useListbox — virtual focus", () => {
  it("has no active option until something activates one", () => {
    const { result } = renderListbox({ defaultValue: "cherry" });
    expect(result.current.activeValue).toBeNull();
    expect(result.current.getListboxProps()["aria-activedescendant"]).toBeUndefined();
  });

  it("activates the selected option on focus, and the first enabled one otherwise", () => {
    const selected = renderListbox({ defaultValue: "cherry" });
    act(() => {
      selected.result.current.activateInitialOption();
    });
    expect(selected.result.current.activeValue).toBe("cherry");

    const unselected = renderListbox();
    act(() => {
      unselected.result.current.activateInitialOption();
    });
    expect(unselected.result.current.activeValue).toBe("apple");
  });

  it("never activates a disabled option, even when it is the selected one", () => {
    const { result } = renderListbox({ defaultValue: "banana" });
    act(() => {
      result.current.activateInitialOption();
    });
    expect(result.current.activeValue).toBe("apple");
  });

  it("points aria-activedescendant at the active option's id", () => {
    const { result } = renderListbox();
    act(() => {
      result.current.setActiveValue("cherry");
    });

    expect(result.current.getListboxProps()["aria-activedescendant"]).toBe(
      result.current.optionId("cherry"),
    );
    expect(result.current.getOptionProps("cherry")["data-active"]).toBe("");
    expect(result.current.getOptionProps("apple")["data-active"]).toBeUndefined();
  });

  /*
   * `aria-activedescendant` is an IDREF. An option that is filtered out, or
   * disabled, after being activated no longer has an element for the attribute
   * to name — and a dangling IDREF is reported by assistive technology as a
   * broken relationship while looking perfectly fine on screen. Deriving the
   * active option from the live list every render is what stops that.
   */
  it("drops virtual focus when the active option leaves the list", () => {
    const { result, rerender } = renderHook(
      ({ options }: { options: readonly ListboxOption<Fruit>[] }) =>
        useListbox<Fruit>({ options, label: "Fruit" }),
      { initialProps: { options: FRUITS } },
    );

    act(() => {
      result.current.setActiveValue("cherry");
    });
    expect(result.current.activeValue).toBe("cherry");

    rerender({ options: FRUITS.filter((option) => option.value !== "cherry") });
    expect(result.current.activeValue).toBeNull();
    expect(result.current.getListboxProps()["aria-activedescendant"]).toBeUndefined();
  });

  it("drops virtual focus when the active option becomes disabled", () => {
    const { result, rerender } = renderHook(
      ({ options }: { options: readonly ListboxOption<Fruit>[] }) =>
        useListbox<Fruit>({ options, label: "Fruit" }),
      { initialProps: { options: FRUITS } },
    );

    act(() => {
      result.current.setActiveValue("cherry");
    });

    rerender({
      options: FRUITS.map((option) =>
        option.value === "cherry" ? { ...option, disabled: true } : option,
      ),
    });
    expect(result.current.activeValue).toBeNull();
  });
});

describe("useListbox — keyboard", () => {
  it("moves virtual focus with the arrow keys, skipping disabled options", () => {
    const { result } = renderListbox();

    press(result, "ArrowDown");
    expect(result.current.activeValue).toBe("apple");

    press(result, "ArrowDown");
    expect(result.current.activeValue).toBe("apricot");

    // Banana is disabled and is not a stop.
    press(result, "ArrowDown");
    expect(result.current.activeValue).toBe("cherry");

    press(result, "ArrowUp");
    expect(result.current.activeValue).toBe("apricot");
  });

  /*
   * A tablist wraps; APG's listbox does not. Wrapping here would make "have I
   * reached the end of the list?" unanswerable without counting the options.
   */
  it("stops at the ends rather than wrapping", () => {
    const { result } = renderListbox();

    press(result, "End");
    expect(result.current.activeValue).toBe("new-york");
    press(result, "ArrowDown");
    expect(result.current.activeValue).toBe("new-york");

    press(result, "Home");
    expect(result.current.activeValue).toBe("apple");
    press(result, "ArrowUp");
    expect(result.current.activeValue).toBe("apple");
  });

  it("stops Home and End on enabled options only", () => {
    const { result } = renderListbox({
      options: [
        { value: "apple", label: "Apple", disabled: true },
        { value: "cherry", label: "Cherry" },
        { value: "new-york", label: "New York", disabled: true },
      ],
    });

    press(result, "Home");
    expect(result.current.activeValue).toBe("cherry");
    press(result, "End");
    expect(result.current.activeValue).toBe("cherry");
  });

  it("does nothing on arrow keys when every option is disabled", () => {
    const { result } = renderListbox({
      options: [{ value: "apple", label: "Apple", disabled: true }],
    });

    press(result, "ArrowDown");
    expect(result.current.activeValue).toBeNull();
  });

  it("commits the active option on Enter and asks to close", () => {
    const onRequestClose = vi.fn();
    const { result } = renderListbox({ onRequestClose });

    press(result, "ArrowDown");
    press(result, "Enter");

    expect(result.current.selectedValue).toBe("apple");
    expect(onRequestClose).toHaveBeenCalledOnce();
  });

  it("ignores Enter while nothing is active", () => {
    const onRequestClose = vi.fn();
    const { result } = renderListbox({ onRequestClose });

    press(result, "Enter");

    expect(result.current.selectedValue).toBeNull();
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it("asks to close on Escape without changing the selection", () => {
    const onRequestClose = vi.fn();
    const { result } = renderListbox({ onRequestClose, defaultValue: "apple" });

    press(result, "ArrowDown");
    press(result, "Escape");

    expect(onRequestClose).toHaveBeenCalledOnce();
    expect(result.current.selectedValue).toBe("apple");
  });

  it("stops the page scrolling under the keys it handles", () => {
    const { result } = renderListbox();
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "a"]) {
      expect(press(result, key).preventDefault).toHaveBeenCalledOnce();
    }
  });

  it("leaves shortcut keystrokes to the browser", () => {
    const { result } = renderListbox();

    const event = press(result, "a", { ctrlKey: true });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(result.current.activeValue).toBeNull();
  });
});

describe("useListbox — typeahead", () => {
  it("jumps to the first option matching what was typed", () => {
    const { result } = renderListbox();

    press(result, "c");

    expect(result.current.activeValue).toBe("cherry");
  });

  it("refines the match as more characters arrive", () => {
    const { result } = renderListbox();

    press(result, "a");
    expect(result.current.activeValue).toBe("apple");
    press(result, "p");
    press(result, "r");
    expect(result.current.activeValue).toBe("apricot");
  });

  it("cycles through same-letter options when the letter is repeated", () => {
    const { result } = renderListbox();

    press(result, "a");
    expect(result.current.activeValue).toBe("apple");
    press(result, "a");
    expect(result.current.activeValue).toBe("apricot");
    press(result, "a");
    expect(result.current.activeValue).toBe("apple");
  });

  it("skips disabled options when matching", () => {
    const { result } = renderListbox();

    press(result, "b");

    expect(result.current.activeValue).toBeNull();
  });

  /*
   * Space is two keys wearing one hat: it commits the active option, and it is
   * a character inside a search. Committing unconditionally makes every
   * multi-word label unreachable by typing — "New " would select whatever the
   * "n" had landed on and close the list.
   */
  it("types a space into an in-flight search instead of committing", () => {
    const onRequestClose = vi.fn();
    const { result } = renderListbox({ onRequestClose });

    press(result, "n");
    press(result, "e");
    press(result, "w");
    press(result, " ");
    press(result, "y");

    expect(result.current.activeValue).toBe("new-york");
    expect(result.current.selectedValue).toBeNull();
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it("commits on Space once the search buffer has expired", () => {
    vi.useFakeTimers();
    const { result } = renderListbox({ typeaheadTimeoutMs: 300 });

    press(result, "c");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    press(result, " ");

    expect(result.current.selectedValue).toBe("cherry");
  });

  it("forgets the buffer when the listbox loses focus", () => {
    const { result } = renderListbox();

    press(result, "n");
    act(() => {
      result.current.getListboxProps().onBlur();
    });
    press(result, " ");

    // With the buffer cleared, Space commits rather than extending "n ".
    expect(result.current.selectedValue).toBe("new-york");
  });

  it("clears its pending timer when the component goes away", () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const { result, unmount } = renderListbox();

    press(result, "c");
    unmount();

    expect(clearSpy).toHaveBeenCalled();
  });
});

describe("findTypeaheadMatch", () => {
  it("returns nothing for an empty buffer", () => {
    expect(findTypeaheadMatch(FRUITS, "", null)).toBeNull();
  });

  it("matches case-insensitively from the start of the label", () => {
    expect(findTypeaheadMatch(FRUITS, "CHER", null)?.value).toBe("cherry");
    expect(findTypeaheadMatch(FRUITS, "herry", null)).toBeNull();
  });

  it("searches onward from the current position and wraps", () => {
    expect(findTypeaheadMatch(FRUITS, "a", "apple")?.value).toBe("apricot");
    expect(findTypeaheadMatch(FRUITS, "a", "apricot")?.value).toBe("apple");
  });
});

describe("useListbox — prop getters", () => {
  it("describes each option to assistive technology", () => {
    const { result } = renderListbox({ defaultValue: "apple" });

    expect(result.current.getOptionProps("apple")).toMatchObject({
      role: "option",
      "aria-selected": true,
      "aria-disabled": undefined,
    });
    expect(result.current.getOptionProps("banana")).toMatchObject({
      "aria-selected": false,
      "aria-disabled": true,
    });
  });

  it("names the listbox and makes it a single tab stop", () => {
    const props = renderListbox().result.current.getListboxProps();

    expect(props.role).toBe("listbox");
    expect(props["aria-label"]).toBe("Fruit");
    expect(props.tabIndex).toBe(0);
  });

  it("gives every hook instance its own ids", () => {
    const first = renderListbox().result.current;
    const second = renderListbox().result.current;

    expect(first.listboxId).not.toBe(second.listboxId);
    expect(first.optionId("apple")).not.toBe(second.optionId("apple"));
    expect(first.optionId("apple")).toContain(first.listboxId);
  });

  it("selects on click and asks to close", () => {
    const onRequestClose = vi.fn();
    const { result } = renderListbox({ onRequestClose });

    act(() => {
      result.current.getOptionProps("cherry").onClick();
    });

    expect(result.current.selectedValue).toBe("cherry");
    expect(result.current.activeValue).toBe("cherry");
    expect(onRequestClose).toHaveBeenCalledOnce();
  });

  it("ignores a click on a disabled option", () => {
    const onRequestClose = vi.fn();
    const { result } = renderListbox({ onRequestClose });

    act(() => {
      result.current.getOptionProps("banana").onClick();
    });

    expect(result.current.selectedValue).toBeNull();
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  /*
   * An option the hook has never heard of can never be reached by keyboard,
   * never matched by typeahead, and never named by `aria-activedescendant`.
   * It renders perfectly, which is why this throws rather than shrugging.
   */
  it("refuses to describe an option that is not in the list", () => {
    const { result } = renderListbox();

    expect(() => result.current.getOptionProps("durian" as Fruit)).toThrow(
      /no option with value "durian"/,
    );
  });
});
