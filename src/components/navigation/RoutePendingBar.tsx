import { cn } from "@/lib/cn";
import { useRouteTransition } from "@/router/routeTransition";

/**
 * The only sign that a held navigation is happening at all.
 *
 * A transition keeps the previous page on screen, which is the point — but it
 * also means a click on a slow route produces no visible change whatsoever.
 * Without something here the app reads as having ignored the click, which is a
 * worse failure than the skeleton flash this replaces.
 *
 * The bar is `aria-hidden` and the announcement is a separate visually-hidden
 * live region. Labelling the bar itself would put a `role="status"` accessible
 * name next to the nav landmark, which is the collision that made the page
 * skeletons decorative in the first place.
 */
export function RoutePendingBar() {
  const { isPending, pendingHref } = useRouteTransition();

  return (
    <>
      <div
        aria-hidden="true"
        data-testid="route-pending-bar"
        data-pending={isPending ? "true" : "false"}
        className={cn(
          "pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5",
          "bg-[var(--color-primary)] transition-opacity duration-150",
          isPending ? "animate-pulse opacity-100" : "opacity-0",
        )}
      />
      <span role="status" aria-live="polite" className="sr-only">
        {isPending && pendingHref !== null ? `Loading ${pendingHref}` : ""}
      </span>
    </>
  );
}
