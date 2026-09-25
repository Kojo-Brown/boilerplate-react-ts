import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/shared/lib/cn";
import { findTypeaheadMatch, DEFAULT_TYPEAHEAD_TIMEOUT_MS } from "@/shared/hooks/useListbox";

/**
 * The APG menu-button pattern: a button that opens a list of **commands**.
 *
 * It looks like `SelectMenu` and is a different control, which is the whole
 * reason it is not built on `useListbox`. A listbox holds a *value* — one of
 * its options is true of the world right now, `aria-selected` says which, and
 * the trigger shows it back to you. A menu holds *actions* — nothing in it is
 * selected, invoking one does something and the menu is gone. Reaching for the
 * listbox because the markup would be similar gets you a control that
 * announces "3 of 7, Delete, selected" about a thing that deleted a row.
 *
 * Four behaviours follow from that difference and none of them is cosmetic:
 *
 * - **Real focus, not virtual focus.** `useListbox` keeps DOM focus on the
 *   list and moves `aria-activedescendant`, which is right for a listbox
 *   because the list *is* the control. A menu's items are each a control, so
 *   focus moves to them — a roving tab stop. That in turn is what makes
 *   `scrollIntoView` unnecessary here (the browser does it for a real focus
 *   move) and what makes the Tab key meaningful below.
 * - **Arrow keys wrap.** APG wraps in a menu and stops at the ends in a
 *   listbox, and the reason is the difference above: "am I at the end of the
 *   list?" is a question about a set of values you are choosing between, and
 *   nobody asks it of six commands.
 * - **Tab closes it.** A menu is transient — over the page, not part of it —
 *   so Tab dismisses it and moves on past the trigger rather than walking into
 *   whatever is underneath. Escape closes it too, and both put focus back on
 *   the trigger.
 * - **Disabled items stay reachable.** See the `aria-disabled` note on the
 *   item below; this is the one place the menu deliberately contradicts
 *   `useListbox`.
 */

export interface MenuItemDescriptor {
  /** Stable key, and what `onSelect` is called with. */
  id: string;
  /** Visible text. Typeahead matches against it, so it is not optional. */
  label: string;
  disabled?: boolean | undefined;
}

export interface MenuProps {
  items: readonly MenuItemDescriptor[];
  /** Trigger text, and the accessible name of the menu it opens. */
  label: string;
  onSelect: (id: string) => void;
  /** How long a typeahead buffer survives between keystrokes. */
  typeaheadTimeoutMs?: number | undefined;
  className?: string | undefined;
}

/**
 * Where focus lands when the menu opens.
 *
 * APG: the trigger's ArrowDown opens onto the first item and ArrowUp onto the
 * last, because "open this and give me the bottom entry" is one keystroke for
 * a keyboard user and six for anyone who has to arrow there. A pointer click
 * opens with focus on the menu container and nothing highlighted — the mouse
 * is already where it wants to be, and highlighting an item the user has not
 * aimed at invites them to press Enter on it.
 */
type OpenIntent = "first" | "last" | "none";

export function Menu({
  items,
  label,
  onSelect,
  typeaheadTimeoutMs = DEFAULT_TYPEAHEAD_TIMEOUT_MS,
  className,
}: MenuProps): ReactNode {
  const baseId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [openIntent, setOpenIntent] = useState<OpenIntent>("none");

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typeaheadBuffer = useRef("");
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const menuId = `${baseId}-menu`;
  const itemId = useCallback((id: string): string => `${baseId}-item-${id}`, [baseId]);

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
   * The menu items, read from the DOM at the moment a key is pressed rather
   * than from a registry the items write to on mount — the same reasoning as
   * `<Tabs.List>`. Mount order is not DOM order once an item is rendered
   * conditionally, so a registry sends ArrowDown to the end of the menu for an
   * item inserted in the middle after the first render. Reading the document
   * also gets reordering for free.
   *
   * Disabled items are *included*, unlike the listbox's enabled-only walk.
   */
  const itemElements = useCallback((): HTMLElement[] => {
    const menu = menuRef.current;
    if (!menu) return [];
    return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }, []);

  const close = useCallback(
    (options: { restoreFocus: boolean }): void => {
      clearTypeahead();
      setIsOpen(false);
      setOpenIntent("none");
      if (options.restoreFocus) triggerRef.current?.focus();
    },
    [clearTypeahead],
  );

  /**
   * Focus moves in an effect rather than in the handler that opened the menu,
   * because the items do not exist yet when that handler runs: the popup
   * mounts in the commit after the state change. Keying on the intent as well
   * as `isOpen` also makes the effect idempotent — it runs once per opening
   * rather than on every later render while the menu is open, so it cannot
   * drag focus back to the first item when something else re-renders.
   */
  useEffect(() => {
    if (!isOpen) return;
    if (openIntent === "none") {
      menuRef.current?.focus();
      return;
    }
    const elements = itemElements();
    const target = openIntent === "first" ? elements[0] : elements.at(-1);
    (target ?? menuRef.current)?.focus();
  }, [isOpen, openIntent, itemElements]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target) === true) return;
      // No focus restoration: the pointer has already decided where it is
      // going, and yanking focus back to the trigger would fight it.
      close({ restoreFocus: false });
    };
    // `pointerdown` rather than `click`, for the same reason as `SelectMenu`:
    // a drag that starts inside the popup and ends outside it never fires a
    // `click` on the document, so a dismiss bound to `click` can be defeated.
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [isOpen, close]);

  const focusByOffset = (step: 1 | -1): void => {
    const elements = itemElements();
    if (elements.length === 0) return;
    const currentIndex = elements.findIndex((element) => element === document.activeElement);
    // Wrapping, unlike the listbox — see the note at the top of the file.
    const nextIndex =
      currentIndex === -1
        ? step === 1
          ? 0
          : elements.length - 1
        : (currentIndex + step + elements.length) % elements.length;
    elements[nextIndex]?.focus();
  };

  const runTypeahead = (character: string): void => {
    typeaheadBuffer.current += character;
    if (typeaheadTimer.current !== null) clearTimeout(typeaheadTimer.current);
    typeaheadTimer.current = setTimeout(() => {
      typeaheadBuffer.current = "";
      typeaheadTimer.current = null;
    }, typeaheadTimeoutMs);

    const focusedId = document.activeElement?.getAttribute("data-menu-item-id") ?? null;
    /*
     * `findTypeaheadMatch` is shared with `useListbox` rather than
     * reimplemented here, because the awkward parts of it — "aaa" cycling
     * through the entries beginning with "a" instead of hunting for a label
     * literally called "aaa", and the search starting *after* the current
     * position so repeats advance — are identical in the two patterns and are
     * exactly the parts a second implementation gets subtly wrong.
     *
     * The `disabled` flag is dropped on the way in, which is not an oversight:
     * the matcher skips disabled entries, and a menu wants them found. See the
     * item's `aria-disabled` note.
     */
    const match = findTypeaheadMatch(
      items.map((item) => ({ value: item.id, label: item.label })),
      typeaheadBuffer.current,
      focusedId,
    );
    if (!match) return;
    menuRef.current?.ownerDocument.getElementById(itemId(match.value))?.focus();
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      // Enter and Space would fire the button's click and open it anyway, but
      // they have to open *onto the first item*, which the click path must not
      // do. Preventing the default is what stops the click firing underneath
      // and toggling the menu straight back shut.
      event.preventDefault();
      setIsOpen(true);
      setOpenIntent("first");
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setOpenIntent("last");
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusByOffset(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusByOffset(-1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      // Without `preventDefault` these scroll the page behind the menu.
      event.preventDefault();
      const elements = itemElements();
      (event.key === "Home" ? elements[0] : elements.at(-1))?.focus();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close({ restoreFocus: true });
      return;
    }
    if (event.key === "Tab") {
      /*
       * Deliberately *not* prevented. A menu is transient: Tab closes it and
       * lets the browser carry on with the tab order. Focus is restored to the
       * trigger synchronously here, during keydown, so the browser computes
       * the next stop from the trigger rather than from an item that is about
       * to be unmounted — otherwise the default action resolves against a
       * detached node and focus falls to `<body>`, restarting the tab order at
       * the top of the document.
       *
       * Trapping focus instead would be the dialog's contract, and it leaves a
       * keyboard user in a popup whose only exit is a key nothing told them
       * about.
       */
      close({ restoreFocus: true });
      return;
    }
    if (event.key === " ") {
      /*
       * Space is the listbox's hardest key — there it is both "commit" and "a
       * space in the search", and telling them apart needs the typeahead
       * buffer. Here it is neither, and the reason is that a menu item is a
       * real `<button>`: Space activates the focused one natively, on keyup,
       * and prevented default on keydown is exactly what cancels that. So this
       * branch exists to *not* handle it.
       *
       * The cost is real and small: a menu cannot typeahead across a space, so
       * "Save as…" is reached by "save" rather than by "save a". The exception
       * is Space on the menu container itself, where there is no button to
       * activate and the default action is scrolling the page behind an open
       * popup.
       */
      if (event.target === menuRef.current) event.preventDefault();
      return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      runTypeahead(event.key);
    }
  };

  const handleItemClick = (item: MenuItemDescriptor): void => {
    // The inert half of `aria-disabled`: the attribute tells assistive
    // technology the command is unavailable, and nothing stops the browser
    // dispatching a click on it, so the component has to.
    if (item.disabled === true) return;
    onSelect(item.id);
    close({ restoreFocus: true });
  };

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        // Only while the popup exists: an `aria-controls` naming an unmounted
        // element is a dangling IDREF, the same trap `<Tabs.Tab>` avoids.
        aria-controls={isOpen ? menuId : undefined}
        onClick={() => {
          if (isOpen) {
            close({ restoreFocus: false });
          } else {
            setIsOpen(true);
            setOpenIntent("none");
          }
        }}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          "flex h-10 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-fg)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
        )}
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-[var(--color-muted-fg)]">
          ▾
        </span>
      </button>

      {isOpen ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          /*
           * The container is focusable so a pointer-opened menu has somewhere
           * to put focus that is not an item — see `OpenIntent`. `-1` rather
           * than `0` because it must never become a tab stop of its own: the
           * trigger is this control's single stop in the page's tab order.
           */
          tabIndex={-1}
          onKeyDown={handleMenuKeyDown}
          className={cn(
            "absolute z-10 mt-1 flex min-w-56 flex-col rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-lg",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
          )}
        >
          {items.map((item) => {
            const disabled = item.disabled === true;
            return (
              <button
                key={item.id}
                id={itemId(item.id)}
                type="button"
                role="menuitem"
                data-menu-item-id={item.id}
                /*
                 * `aria-disabled`, never the `disabled` attribute — and this is
                 * the one place the menu deliberately contradicts `useListbox`,
                 * which skips disabled options entirely.
                 *
                 * A disabled *option* is a value you cannot pick and can still
                 * read in the list, because the list is on screen. A disabled
                 * *command* is only ever in a popup, and the only way to learn
                 * that "Restore from backup" exists but is unavailable right
                 * now is to arrive on it. `disabled` takes it out of the tab
                 * order and out of the item count several screen readers
                 * announce, so the same menu is "5 items" to one user and "6
                 * items" to another.
                 *
                 * Keeping it focusable and inert is APG's recommendation for
                 * exactly that reason, which is why `itemElements` does not
                 * filter and why `runTypeahead` drops the flag on the way into
                 * the shared matcher.
                 */
                aria-disabled={disabled ? true : undefined}
                // Roving tab stop: the menu contributes no second stop to the
                // page, and Tab out of it is handled above.
                tabIndex={-1}
                onClick={() => {
                  handleItemClick(item);
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm text-[var(--color-fg)]",
                  "focus:bg-[var(--color-muted)] focus:outline-none",
                  disabled && "cursor-not-allowed text-[var(--color-muted-fg)]",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
