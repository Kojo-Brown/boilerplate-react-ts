import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { useErrorReporter } from "@/shared/observability/errorReporterContext";
import { clickBreadcrumb, navigationBreadcrumb } from "@/shared/observability/breadcrumbs";

export interface ErrorBreadcrumbsProps {
  /**
   * Whether to record clicks as well as navigations.
   *
   * On by default and separable because the click listener is the only part
   * with a per-interaction cost, and an app that wants navigation context
   * without it should not have to reimplement the rest.
   */
  trackClicks?: boolean;
}

/**
 * Records what the user did, so the next error arrives with context.
 *
 * Renders nothing. It lives inside the router because a navigation crumb needs
 * `useLocation`, and inside the shell rather than around a page so that it
 * outlives every route swap — a recorder remounted per route would start each
 * page with an empty trail, which is exactly the trail worth having.
 *
 * The click listener is registered on `document` in the **capture** phase.
 * Bubbling would be the conventional choice and would miss the interesting
 * cases: any handler between the target and the document that calls
 * `stopPropagation()` — which menus, dialogs and dropdowns do routinely —
 * silently removes those clicks from the trail. Capture runs before the target
 * is reached, so nothing downstream can suppress it.
 *
 * Nothing is retained from the event: `clickBreadcrumb` derives a label at
 * record time and the node is dropped. Keeping the `target` to derive it later
 * would pin an element, and its whole subtree, inside a buffer built to
 * outlive both — the detached-node retention `docs/memory-leaks.md` gates
 * against.
 */
export function ErrorBreadcrumbs({ trackClicks = true }: ErrorBreadcrumbsProps) {
  const location = useLocation();
  const reporter = useErrorReporter();
  const previousHref = useRef<string | null>(null);

  const href = `${location.pathname}${location.search}`;

  useEffect(() => {
    const from = previousHref.current;
    previousHref.current = href;
    // The first render is an arrival, not a navigation; recording a
    // `null → /` transition would put a crumb nobody can act on at the head of
    // every trail.
    if (from === null || from === href) return;
    reporter.addBreadcrumb(navigationBreadcrumb(from, href));
  }, [href, reporter]);

  useEffect(() => {
    if (!trackClicks) return;

    const onClick = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // The nearest interactive ancestor, so a click on the `<span>` inside a
      // button is recorded as the button. `closest` walks up from the target
      // itself, so a direct hit on the control still matches.
      const control = target.closest("button, a, [role='button'], input, select, textarea");
      reporter.addBreadcrumb(clickBreadcrumb(control ?? target));
    };

    document.addEventListener("click", onClick, { capture: true });
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
    };
  }, [reporter, trackClicks]);

  return null;
}
