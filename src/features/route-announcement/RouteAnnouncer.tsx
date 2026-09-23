import { useEffect, useRef, useState } from "react";
import { useLocation, useMatches } from "react-router";
import { MAIN_CONTENT_ID } from "@/shared/ui/SkipLink";
import {
  documentTitle,
  routeAnnouncement,
  routeTitleFromMatches,
} from "@/features/route-announcement/routeTitle";

export interface RouteAnnouncerProps {
  /**
   * The element focus moves to on arrival. Defaults to the shell's `<main>`.
   *
   * By id rather than by ref, because the other thing that sends focus there
   * is a `<a href="#main-content">` in the header, and an id is the contract
   * those two already share. A ref would give the route change a private
   * second answer to a question the skip link answers in the markup.
   */
  readonly focusTargetId?: string;
}

/** Which of the two live regions is currently holding the announcement. */
interface Announcement {
  readonly slot: 0 | 1;
  readonly text: string;
}

const SILENT: Announcement = { slot: 0, text: "" };

/**
 * Says the new page's name, and puts focus at the top of it.
 *
 * Both halves of the same event, in one component on purpose: they have to
 * agree on when a navigation happened, and two components deciding that
 * separately is how an app ends up announcing a page it did not move focus to.
 *
 * ## Why a route change needs announcing at all
 *
 * A link in a multi-page site produces a document load, and a screen reader
 * responds to that by saying the new page's title while the browser moves
 * focus to the top of the document. A client-side router produces neither, so
 * unless something in the app says so a navigation is silent: the reader is
 * still on the old page as far as anything has told them, and focus is left on
 * a link in content that may no longer exist.
 *
 * ## Telling a navigation from a page load
 *
 * `location.key` is the literal string `"default"` for the entry the history
 * stack starts on and a generated id for every entry pushed after it. That is
 * most of the answer but not all of it, and the two gaps point opposite ways.
 *
 * A `useRef(true)` "first render" flag would miss the navigation that arrives
 * from `/login` — that route is outside this layout, so signing in mounts a
 * *fresh* announcer mid-session and the flag would suppress the one
 * announcement the flow most needs.
 *
 * `key !== "default"` alone would miss the way back: the first entry keeps its
 * key for the life of the stack, so pressing Back onto the landing page is a
 * real navigation wearing the initial load's key.
 *
 * So the test is both — this announcer has not seen a key before *and* the key
 * is the stack's first — which is true only of an actual document load.
 *
 * ## Why the text arrives in an effect, and why there are two regions
 *
 * A live region is announced when its contents change *while it is already in
 * the document*. A region that appears with its text already in it is a new
 * node rather than a mutation, and is commonly not announced at all — so the
 * regions ship mounted and empty from the first paint, and the effect fills
 * one on the commit after.
 *
 * Two of them, alternating, because the mutation has to be real at the DOM
 * level: going `/about` → `/` → `/about` would set the same string twice,
 * React would correctly decline to touch the text node, and the third
 * navigation would be silent. Moving the text between two regions means every
 * announcement is an empty region gaining content.
 *
 * Focus moves in the same effect, before the text lands. The order the user
 * gets is therefore "main", then the page name — which is the right way round,
 * and why the regions are `polite`: an assertive one would interrupt the focus
 * announcement rather than queue behind it.
 */
export function RouteAnnouncer({ focusTargetId = MAIN_CONTENT_ID }: RouteAnnouncerProps = {}) {
  const location = useLocation();
  const matches = useMatches();
  const title = routeTitleFromMatches(matches);
  const routeKey = location.key;

  const [announcement, setAnnouncement] = useState<Announcement>(SILENT);
  const seenKeyRef = useRef<string | null>(null);

  useEffect(() => {
    document.title = documentTitle(title);
  }, [title]);

  useEffect(() => {
    const previousKey = seenKeyRef.current;
    seenKeyRef.current = routeKey;
    if (previousKey === routeKey) return;
    if (previousKey === null && routeKey === "default") return;

    /*
     * `preventScroll` because scrolling belongs to `<ScrollRestoration>`, and
     * the two disagree on the case that matters: pressing Back should return
     * the user to where they were on the previous page, and a `focus()` that
     * scrolls would drag them to the top of it a frame later. Focus and scroll
     * are separate questions here, and only one of them is this component's.
     */
    document.getElementById(focusTargetId)?.focus({ preventScroll: true });

    const text = routeAnnouncement(title);
    setAnnouncement((previous) => ({ slot: previous.slot === 0 ? 1 : 0, text }));
    // `title` is read rather than depended on: it is derived from the same
    // location as the key, so a change to it without a new key is a route
    // renaming itself mid-session, which is not a navigation to announce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, focusTargetId]);

  return (
    <span className="sr-only" data-testid="route-announcer">
      <span role="status" aria-live="polite">
        {announcement.slot === 0 ? announcement.text : ""}
      </span>
      <span role="status" aria-live="polite">
        {announcement.slot === 1 ? announcement.text : ""}
      </span>
    </span>
  );
}
