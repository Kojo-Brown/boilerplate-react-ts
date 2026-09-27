import { useSyncExternalStore } from "react";
import { announcer as defaultAnnouncer, type Announcer } from "@/shared/a11y/announcer";

export interface LiveRegionsProps {
  /** Defaults to the application's announcer. Injected by tests. */
  readonly announcer?: Announcer;
}

/**
 * The four `sr-only` regions every announcement is spoken through.
 *
 * Two per politeness, alternating — see `announcer.ts` for why there are two of
 * each and why one is not enough.
 *
 * ## Where this goes, and why not in the shell
 *
 * Next to `<RouterProvider>` in `App`, above the router rather than inside
 * `RootLayout`, for two reasons that both come down to outliving things:
 *
 * - `/login` and `/auth/callback` render outside `RootLayout`. A region in the
 *   shell does not exist on those routes, so a failed sign-in would announce
 *   into nothing — the one flow where an unheard error message costs the user
 *   the session.
 * - A live region that unmounts takes its queued speech with it. Mounted above
 *   every route, these four are mounted once for the life of the document,
 *   which is also the only way the "already in the document" precondition for
 *   an announcement is true of the *first* one.
 *
 * It renders before `<RouterProvider>` in document order as well, so its
 * subscription effect runs before any page's — but the store queues until
 * something subscribes anyway, because effect order is not a thing to rely on
 * across a lazy route boundary.
 *
 * ## Why it reads the store here and not higher
 *
 * This is a leaf. Reading an external store in a component that *wraps* the
 * routes is paid for by every update beneath it — measured in
 * `OfflineIndicators.tsx` at 96ms → 250ms worst keypress-to-paint — whereas a
 * sibling that renders four text nodes re-renders four text nodes.
 */
export function LiveRegions({ announcer = defaultAnnouncer }: LiveRegionsProps = {}) {
  const state = useSyncExternalStore(announcer.subscribe, announcer.getState, announcer.getState);

  return (
    <div className="sr-only" data-testid="live-regions">
      {/*
        `aria-live` and `aria-atomic` rather than `role="status"` and
        `role="alert"`, which are defined as exactly those two attribute pairs and
        would be equivalent to an assistive technology. The difference is
        everywhere else.

        These four elements are in the document for the life of the page and hold
        nothing almost all of that time, so a role on them is a permanent claim to
        be a status message or an alert. Anything that asks the document for its
        alerts gets them: `page.getByRole("alert")` on the login page would match
        the form's error *and* two empty spans, which is a strict-mode failure in
        a test that was correct, and an extra pair of entries in the element list
        a screen-reader user navigates by. `RoutePendingBar` already carries a
        test id for the smaller version of this problem.

        `aria-atomic` is the load-bearing half of the pair: without it a reader may
        announce only the parts of the subtree that changed, which for "12
        results" following "2 results" is the word "12" on its own.
      */}
      <span aria-live="polite" aria-atomic="true" data-testid="polite-0">
        {state.polite.slot === 0 ? state.polite.text : ""}
      </span>
      <span aria-live="polite" aria-atomic="true" data-testid="polite-1">
        {state.polite.slot === 1 ? state.polite.text : ""}
      </span>
      {/*
        Separate elements rather than one region whose `aria-live` flips with the
        message. Changing a live region's politeness is not defined to apply to
        an announcement already in flight, and a reader that has cached the
        region's properties will speak an error politely or a status update over
        the top of the user — the two failures this distinction exists to avoid,
        picked at random.
      */}
      <span aria-live="assertive" aria-atomic="true" data-testid="assertive-0">
        {state.assertive.slot === 0 ? state.assertive.text : ""}
      </span>
      <span aria-live="assertive" aria-atomic="true" data-testid="assertive-1">
        {state.assertive.slot === 1 ? state.assertive.text : ""}
      </span>
    </div>
  );
}
