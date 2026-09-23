import { useEffect, useRef, type RefObject } from "react";
import { getTabbableElements, nextTabStop } from "@/shared/lib/focusTrap";

export interface FocusTrapOptions {
  /**
   * Whether the trap is on.
   *
   * A boolean rather than mounting and unmounting the hook, because the
   * element being trapped usually outlives the trap: this app's drawer is in
   * the DOM the whole time and only becomes modal when it slides in. Turning
   * the trap off restores focus exactly as unmounting would.
   */
  readonly active: boolean;
  /**
   * Called when Escape is pressed inside the trap. Optional — a trap with no
   * way out is a valid thing to build (a blocking confirmation), so this is
   * not defaulted to anything that closes.
   */
  readonly onEscape?: (() => void) | undefined;
  /**
   * What to focus when the trap activates. Defaults to the first tabbable
   * element, then to the container.
   */
  readonly initialFocus?: RefObject<HTMLElement | null> | undefined;
  /**
   * Whether to put focus back where it was when the trap deactivates.
   * Defaults to true.
   */
  readonly restoreFocus?: boolean | undefined;
}

/**
 * Keeps keyboard focus inside one element for as long as it is active.
 *
 * ## When this is the wrong tool
 *
 * A `<dialog>` opened with `showModal()` already does all of this, in the
 * browser, better: the top layer makes everything behind it inert, Escape
 * closes, and focus is restored on close. `Modal.tsx` uses that and
 * deliberately does **not** use this hook — a second trap layered on a native
 * one is two things racing to move focus after every keydown.
 *
 * What this is for is the overlay that cannot be a `<dialog>`: in this app,
 * the sidebar drawer, which is a modal overlay on a phone and an ordinary
 * landmark on a desktop, decided by a media query. `showModal()` has no
 * conditional form.
 *
 * ## The three things that make a trap hold
 *
 * **Tab at the edges** is the part everyone implements: intercept the keydown,
 * wrap to the other end. On its own it is the weakest of the three, because it
 * only holds if focus was inside to begin with.
 *
 * **Focus that arrives from outside** is the part that gets missed, and the
 * ways in do not involve Tab at all: a click on the page behind, a screen
 * reader moving the virtual cursor, a browser's find-in-page, an `autofocus`
 * in something that mounted late. A `focusin` listener on the document is the
 * only place to catch all of them, because they have nothing else in common.
 *
 * **Restoring focus** is what makes the trap survivable. Focus lands on the
 * element that opened the drawer, not on `<body>` — from `<body>`, the next
 * Tab starts at the top of the document, and the user has lost their place in
 * a page they had not finished reading.
 */
export function useFocusTrap<T extends HTMLElement>(
  options: FocusTrapOptions,
): RefObject<T | null> {
  const { active, onEscape, initialFocus, restoreFocus = true } = options;
  const containerRef = useRef<T | null>(null);

  /*
   * `onEscape` is read through a ref so the trap does not tear down and
   * rebuild — and, worse, re-run its focus-moving setup — every time a parent
   * renders a new arrow function for it. The callers that matter pass a
   * zustand action, which is stable; the ones that do not should still not
   * have their focus jump back to the top of the drawer on an unrelated
   * re-render.
   */
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    const container = containerRef.current;
    if (!active || container === null) return;

    const doc = container.ownerDocument;
    const view = doc.defaultView;
    if (view === null) return;

    /*
     * Captured inside the effect rather than in a render or an event handler,
     * because this has to be the element that had focus *immediately* before
     * the trap took over. A click on the toggle button leaves focus on that
     * button until something moves it, and the something is the next few
     * lines.
     */
    const previouslyFocused = doc.activeElement;

    const explicit = initialFocus?.current ?? null;
    const target = explicit ?? getTabbableElements(container)[0] ?? container;
    target.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Not `preventDefault`: Escape has other meanings in the page — it
        // stops a load, closes a native autocomplete popup — and this trap has
        // no standing to decide it did not mean one of those. Closing on
        // Escape is a reaction, not an interception.
        onEscapeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;

      const stop = nextTabStop(container, doc.activeElement, event.shiftKey);
      if (stop === null) return;
      event.preventDefault();
      stop.element.focus();
    };

    const handleFocusIn = (event: FocusEvent) => {
      const landed = event.target;
      if (!(landed instanceof view.Node)) return;
      if (container.contains(landed)) return;
      /*
       * Pull focus back to the start rather than to where it came from. Where
       * it came from is not knowable here — `relatedTarget` is the element
       * losing focus, which for a click on the page behind is an element
       * inside the trap, and re-focusing that would fight a user who is
       * legitimately Shift-Tabbing backwards out of the first control.
       * Sending them to the top of the trap is at least a place they can
       * navigate from.
       */
      (getTabbableElements(container)[0] ?? container).focus();
    };

    /*
     * Both on the document, and `keydown` in the *capture* phase. Bubbling
     * would work for the trap itself, but a control inside it that stops
     * propagation on its own keydown — a listbox swallowing keys, a text field
     * in a library component — would silently switch the trap off for as long
     * as it holds focus. Capture runs before any of that.
     *
     * `focusin` is used rather than `focus` because `focus` does not bubble;
     * `focusin` is the one that can be listened for at the document.
     */
    doc.addEventListener("keydown", handleKeyDown, true);
    doc.addEventListener("focusin", handleFocusIn);

    return () => {
      doc.removeEventListener("keydown", handleKeyDown, true);
      doc.removeEventListener("focusin", handleFocusIn);

      if (!restoreFocus) return;
      /*
       * Only restore if the remembered element is still in the document and
       * still focusable. A drawer whose opener was itself removed — a toolbar
       * that collapsed, a row that was deleted — would otherwise throw or,
       * worse, silently focus a detached node, which reads to a screen reader
       * as focus vanishing.
       */
      if (!(previouslyFocused instanceof view.HTMLElement)) return;
      if (!previouslyFocused.isConnected) return;
      previouslyFocused.focus();
    };
    // `initialFocus` is a ref object: stable by construction, and read inside
    // the effect precisely so that the element it points at may arrive late.
  }, [active, initialFocus, restoreFocus]);

  return containerRef;
}
