/**
 * The DOM half of a focus trap: which elements Tab can reach, and where Tab
 * should go next.
 *
 * Kept apart from `useFocusTrap` because everything interesting here is a
 * question about a DOM tree rather than about React — "is this button
 * reachable", "what comes after the last one" — and questions about a DOM tree
 * can be asked of a `<div>` a test built in three lines, with no component, no
 * act(), and no render. The hook is then the small part: listeners, restore,
 * lifecycle.
 */

/**
 * Elements that can hold focus, before any of the filtering below.
 *
 * `[tabindex]` is matched unqualified rather than as `[tabindex="0"]`, because
 * a positive `tabindex` is also tabbable and a negative one has to be *seen*
 * to be excluded — a selector that never matches `tabindex="-1"` cannot tell
 * "programmatically focusable" from "not focusable at all", and the container
 * itself is usually the former.
 *
 * `audio`/`video` carry `controls` because that is what makes them focusable;
 * without it they are not in the tab order. `[contenteditable]` is matched on
 * the attribute rather than the property since the attribute is what the
 * markup states.
 */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "input",
  "select",
  "textarea",
  "audio[controls]",
  "video[controls]",
  "iframe",
  "object",
  "embed",
  "summary",
  "[contenteditable]",
  "[tabindex]",
].join(",");

/** True when `element` or an ancestor is hidden from the tab order outright. */
function isHiddenSubtree(element: HTMLElement): boolean {
  /*
   * `hidden` and `inert` are checked on ancestors, not just on the element:
   * both are inherited by the subtree, and the drawer this trap was written
   * for is exactly that case — a closed `<aside inert>` whose links are
   * individually unremarkable.
   */
  if (element.closest("[hidden]") !== null) return true;
  if (element.closest("[inert]") !== null) return true;

  /*
   * `display: none` and `visibility: hidden` also remove an element from the
   * tab order, and only computed style knows: either can come from a class on
   * an ancestor. This deliberately does *not* try to detect zero-sized or
   * off-screen elements — `offsetParent`, `getBoundingClientRect` and
   * `checkVisibility` all need layout, which jsdom does not do, so a filter
   * built on them would be untestable in the suite that has to pin this
   * behaviour and would quietly pass everything there.
   *
   * The consequence is stated rather than hidden: an element moved off screen
   * with `transform` is still tabbable, and a drawer that slides away has to
   * say so with `inert` rather than relying on this function to notice. That
   * is the correct answer anyway — `transform` does not remove anything from
   * the tab order in a real browser either.
   */
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (style === undefined) return false;
  return style.display === "none" || style.visibility === "hidden";
}

/** True when the element is disabled, which removes it from the tab order. */
function isDisabled(element: HTMLElement): boolean {
  // `disabled` is a property of the form elements that have it, and reading it
  // off `HTMLElement` needs the check rather than a cast: `aria-disabled` is
  // deliberately *not* treated as disabled, since it leaves the element
  // focusable by design.
  return element.matches(":disabled");
}

/**
 * Every element inside `container` that Tab can reach, in tab order.
 *
 * "In tab order" here means document order, which is the whole of it as long
 * as no element carries a positive `tabindex`. A positive value re-orders the
 * sequence document-wide, so honouring one would mean sorting against elements
 * *outside* the container — the one thing a trap cannot see. It is included
 * anyway, in document order, because the alternative is worse in a way that is
 * easy to miss: an element left out of this list is one the trap will never
 * hand focus to and will actively pull focus away from, so a control the
 * author marked as *more* important than its neighbours becomes the one
 * control in the dialog nobody can reach. Being visited in the wrong order is
 * a smaller failure than being unreachable, and it is the author's to fix —
 * `eslint-plugin-jsx-a11y`'s `no-positive-tabindex` exists for that reason.
 *
 * The container itself is never included, even when it is focusable — it is
 * the fallback for an empty trap, not a tab stop inside one.
 */
export function getTabbableElements(container: HTMLElement): HTMLElement[] {
  const candidates = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  return Array.from(candidates).filter((element) => {
    if (element.tabIndex < 0) return false;
    if (isDisabled(element)) return false;
    return !isHiddenSubtree(element);
  });
}

/** Where Tab should move focus, given who has it now. */
export interface TabStop {
  /** The element to focus. */
  readonly element: HTMLElement;
  /**
   * True when the browser would have done something else, so the keydown has
   * to be prevented for this to take effect.
   *
   * Always true today — the function returns `null` for the cases the browser
   * already gets right — but it is on the result rather than implied, because
   * "focus this" and "focus this *instead*" are different instructions and the
   * caller is the one holding the event.
   */
  readonly preventDefault: true;
}

/**
 * The element Tab should move to, or `null` to let the browser decide.
 *
 * Returning `null` for the ordinary case is the point: inside a trap, most
 * Tab presses are moving between two adjacent controls and the browser's own
 * sequential navigation is better at that than any re-implementation of it —
 * it knows about shadow roots, iframes and the `tabindex` ordering this
 * function declines to model. Only the two edges need intercepting, plus the
 * case where focus is already somewhere it should not be.
 *
 * @param container - The element focus must stay inside.
 * @param active - The element that currently has focus, usually
 *   `document.activeElement`.
 * @param shiftKey - True for Shift+Tab, which runs the same logic backwards.
 */
export function nextTabStop(
  container: HTMLElement,
  active: Element | null,
  shiftKey: boolean,
): TabStop | null {
  const tabbables = getTabbableElements(container);

  /*
   * An empty trap still has to be a trap. A drawer whose only control is
   * disabled, or a dialog that is still loading its body, would otherwise let
   * Tab walk straight out into the page behind it — the exact thing being
   * prevented, arrived at by the container being *more* restrictive rather
   * than less. Focus goes to the container, which is why callers give it
   * `tabIndex={-1}`.
   */
  const first = tabbables[0];
  const last = tabbables[tabbables.length - 1];
  if (first === undefined || last === undefined) {
    return container === active ? null : { element: container, preventDefault: true };
  }

  /*
   * Focus outside the container: pull it to whichever end Tab is heading
   * towards, so the direction the user pressed still means what it means. This
   * covers the container itself holding focus, which is the state the empty
   * case above leaves behind and the state a freshly opened trap starts in.
   */
  if (active === null || active === container || !container.contains(active)) {
    return { element: shiftKey ? last : first, preventDefault: true };
  }

  if (!shiftKey && active === last) return { element: first, preventDefault: true };
  if (shiftKey && active === first) return { element: last, preventDefault: true };

  return null;
}
