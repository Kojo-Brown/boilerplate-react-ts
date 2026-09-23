import type { UIMatch } from "react-router";
import { APP_NAME } from "@/shared/config/app";

/**
 * What a route says about itself, beyond its path and its element.
 *
 * React Router's `handle` is an arbitrary value attached to a route object and
 * handed back by `useMatches`, which makes it the one place a title can live
 * where it is both next to the route and readable from above it. The
 * alternative — a `Record<path, string>` in `shared/` — is a second list of
 * every route, and the failure mode of a second list is that it is correct on
 * the day it is written.
 *
 * `useMatches` also solves the case a path-keyed map gets wrong: `/nonsense`
 * matches the `*` route, so the deepest match's handle says "Page not found"
 * rather than anything derived from the URL the user mistyped.
 */
export interface RouteHandle {
  /**
   * The page's name, as a person would say it: "Dashboard", not "/dashboard".
   *
   * It is what gets announced on arrival and what goes in the document title,
   * so it is a phrase rather than a sentence and carries no "page" suffix —
   * both of its consumers add their own wording around it.
   */
  readonly title: string;
}

/** Narrows the `unknown` that `useMatches` reports a handle as. */
export function isRouteHandle(handle: unknown): handle is RouteHandle {
  if (typeof handle !== "object" || handle === null) return false;
  if (!("title" in handle)) return false;
  return typeof handle.title === "string" && handle.title.length > 0;
}

/**
 * The title of the deepest matched route that declares one, or `null`.
 *
 * Deepest rather than first, because the matches run from the root layout down
 * and it is the leaf that knows what page this is. Layout routes are expected
 * to carry no handle at all — `RootLayout` has nothing to call itself that
 * would be true of the twenty-odd pages it hosts.
 *
 * `null` is returned rather than a title derived from the path. A route with
 * no handle is a mistake in the route config, `router.test.tsx` fails on it,
 * and inventing "Query cache" from `/labs/query-cache` here would make that
 * mistake produce plausible output — which is how it survives to production.
 * The caller decides what to do with nothing, and what it does is stay quiet.
 */
export function routeTitleFromMatches(matches: readonly UIMatch[]): string | null {
  for (let i = matches.length - 1; i >= 0; i--) {
    const handle = matches[i]?.handle;
    if (isRouteHandle(handle)) return handle.title;
  }
  return null;
}

/** The `document.title` for a page, or the bare product name when unknown. */
export function documentTitle(routeTitle: string | null): string {
  return routeTitle === null ? APP_NAME : `${routeTitle} · ${APP_NAME}`;
}

/**
 * What the live region says on arrival.
 *
 * "…, page loaded" rather than bare "Dashboard", because a polite region
 * speaks into whatever the user was doing and a lone noun is indistinguishable
 * from a label read out of the page. Naming the event is what makes it
 * navigation rather than noise.
 */
export function routeAnnouncement(routeTitle: string | null): string {
  return routeTitle === null ? "" : `${routeTitle}, page loaded`;
}
