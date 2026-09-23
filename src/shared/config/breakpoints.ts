/**
 * The breakpoints this app's JavaScript needs to know about.
 *
 * Almost none of it should: a responsive layout belongs in CSS, where the
 * browser re-evaluates it for free and no component re-renders. The exception
 * is a component whose *behaviour* changes with the viewport rather than its
 * appearance — the sidebar is a modal drawer on a phone and an ordinary
 * landmark on a desktop, and a focus trap is not something a media query can
 * switch on.
 *
 * So the value is duplicated between here and Tailwind's `md:` prefix, and the
 * duplication is the reason this file exists rather than the query being
 * inlined at its one call site: the two must move together, and a named
 * constant is what a future edit to the breakpoint will find.
 */

/** Tailwind's `md` breakpoint: 48rem at the default root font size. */
export const MD_BREAKPOINT_PX = 768;

/** Matches when the viewport is at least Tailwind's `md` breakpoint wide. */
export const MD_AND_UP = `(min-width: ${MD_BREAKPOINT_PX}px)`;
