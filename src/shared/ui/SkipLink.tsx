import type { MouseEvent } from "react";
import { cn } from "@/shared/lib/cn";

/**
 * The id of the element holding the routed page.
 *
 * One constant with two consumers, and that is the design rather than a
 * shortcut: the place a skip link sends you and the place focus lands after a
 * route change have to be the same element, or the app has two answers to
 * "where does the content start" and a keyboard user finds out which one is
 * wrong. `RootLayout` puts it on `<main tabIndex={-1}>`.
 */
export const MAIN_CONTENT_ID = "main-content";

export interface SkipLinkProps {
  /** The `id` of the element to move focus to. */
  readonly targetId: string;
  /** What the link says. Visible only while it has focus. */
  readonly children: string;
  readonly className?: string | undefined;
}

/**
 * The first thing in the tab order: a link that jumps past the header and nav.
 *
 * ## Why it is hidden rather than absent
 *
 * It is in the DOM from the first paint and visually hidden with `sr-only`,
 * which keeps it in the tab order — that is the entire mechanism. A link
 * rendered only once focus arrives cannot be focused, because there is nothing
 * to focus until it renders. `focus:not-sr-only` brings it back on screen for
 * sighted keyboard users, who are most of the people it helps: a screen reader
 * user can jump by landmark, a keyboard-only user cannot.
 *
 * ## Why it handles its own click
 *
 * `href="#main-content"` alone very nearly works: the browser scrolls to the
 * target and, because the target has `tabindex="-1"`, moves focus to it. What
 * it also does is put `#main-content` in the address bar, where it stays —
 * through every later navigation, through a copied URL, and into
 * `<ScrollRestoration>`, which reads the location to decide where a route
 * should be scrolled to. Handling the click keeps the fragment out of history
 * while leaving the `href` in place, which is what makes this a link rather
 * than a button with a link's clothes on: it appears in a screen reader's
 * links list, and middle-click and "open in new tab" still do something
 * sensible.
 *
 * The default is prevented only once the target has been found. If the id
 * matches nothing — a layout that moved it, a page rendered outside the shell
 * — the browser's own behaviour is still the best available, and a silent
 * no-op would be the worst.
 */
export function SkipLink({ targetId, children, className }: SkipLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(targetId);
    if (target === null) return;
    event.preventDefault();
    /*
     * No `preventScroll`. The point of the link is to move the reader as well
     * as the focus, and `focus()` scrolling the target into view is how that
     * happens without a second, separately-janky `scrollIntoView`.
     *
     * The focus ring that lands on `<main>` afterwards is deliberate and is
     * left alone. `:focus-visible` matches here — the interaction was a
     * keyboard one — and a keyboard user who has just jumped several hundred
     * pixels needs to be told where they landed more than the page needs to
     * look tidy.
     */
    target.focus();
  };

  return (
    <a
      href={`#${targetId}`}
      onClick={handleClick}
      className={cn(
        "sr-only",
        "focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50",
        "focus:rounded-[var(--radius-sm)] focus:px-4 focus:py-2",
        "focus:bg-[var(--color-surface)] focus:text-sm focus:font-medium",
        "focus:text-[var(--color-fg)] focus:shadow-[var(--shadow-lg)]",
        "focus:outline-2 focus:outline-offset-2 focus:outline-[var(--color-primary)]",
        className,
      )}
    >
      {children}
    </a>
  );
}
