import type { UIMatch } from "react-router";
import type { IntlShape } from "react-intl";
import { APP_NAME } from "@/shared/config/app";
import { isMessageId, type MessageId } from "@/shared/i18n/messages";

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
   * The message id naming the page: `"route.dashboard.title"`.
   *
   * An id rather than the text, because both of this handle's consumers put the
   * result in front of a reader — the tab title and a live region — and a
   * literal here would be the one part of the shell that stayed English in an
   * Arabic session. It is `MessageId`, so a typo is a type error rather than a
   * tab titled `route.dashbord.title`.
   */
  readonly titleId: MessageId;
}

/**
 * Narrows the `unknown` that `useMatches` reports a handle as.
 *
 * Membership in the catalogue is checked, not just the type: `useMatches`
 * erases the handle to `unknown`, so by the time it reaches here the compiler's
 * guarantee is gone and an id that was renamed in the catalogue but not in the
 * route config would arrive as a plausible string. That is precisely the case
 * this guard has to reject, and the case `router.test.tsx` fails on.
 */
export function isRouteHandle(handle: unknown): handle is RouteHandle {
  if (typeof handle !== "object" || handle === null) return false;
  if (!("titleId" in handle)) return false;
  return isMessageId(handle.titleId);
}

/**
 * The title id of the deepest matched route that declares one, or `null`.
 *
 * Deepest rather than first, because the matches run from the root layout down
 * and it is the leaf that knows what page this is. Layout routes are expected
 * to carry no handle at all — `RootLayout` has nothing to call itself that
 * would be true of the twenty-odd pages it hosts.
 *
 * `null` is returned rather than something derived from the path. A route with
 * no handle is a mistake in the route config, `router.test.tsx` fails on it, and
 * inventing "Query cache" from `/labs/query-cache` here would make that mistake
 * produce plausible output — which is how it survives to production. The caller
 * decides what to do with nothing, and what it does is stay quiet.
 */
export function routeTitleIdFromMatches(matches: readonly UIMatch[]): MessageId | null {
  for (let i = matches.length - 1; i >= 0; i--) {
    const handle = matches[i]?.handle;
    if (isRouteHandle(handle)) return handle.titleId;
  }
  return null;
}

/**
 * The `document.title` for a page, or the bare product name when unknown.
 *
 * Takes an `IntlShape` rather than reading one from context, which keeps it a
 * function with an answer that can be asserted against — `createIntl` in a test
 * is cheaper and more precise than rendering a provider to find out what a tab
 * would have said.
 *
 * `APP_NAME` is interpolated rather than concatenated, and the separator lives
 * in the message. A `·` between a page name and a product name is a
 * Latin-typographic convention and the order of the two halves is not universal;
 * both are the translation's to decide.
 */
export function documentTitle(intl: IntlShape, titleId: MessageId | null): string {
  if (titleId === null) {
    return intl.formatMessage({ id: "document.titleFallback" }, { app: APP_NAME });
  }
  return intl.formatMessage(
    { id: "document.title" },
    { page: intl.formatMessage({ id: titleId }), app: APP_NAME },
  );
}

/**
 * What the live region says on arrival.
 *
 * "…, page loaded" rather than a bare page name, because a polite region speaks
 * into whatever the user was doing and a lone noun is indistinguishable from a
 * label read out of the page. Naming the event is what makes it navigation
 * rather than noise — and the wording, the punctuation and the word order are
 * the translation's, which is why this is one message with a placeholder rather
 * than a page name with a suffix stuck on it.
 */
export function routeAnnouncement(intl: IntlShape, titleId: MessageId | null): string {
  if (titleId === null) return "";
  return intl.formatMessage(
    { id: "route.announcement" },
    { page: intl.formatMessage({ id: titleId }) },
  );
}
