import { createPath, type To } from "react-router";

/**
 * Normalises a `To` to the href form the pending UI compares and displays.
 *
 * Its own module so that `routeTransition.tsx` exports components and their
 * hook and nothing else — fast refresh treats any other export as a reason to
 * remount the provider, which would drop the transition it owns.
 */
export function toHref(to: To): string {
  return typeof to === "string" ? to : createPath(to);
}
