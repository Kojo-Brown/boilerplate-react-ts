import { useEffect, useRef } from "react";
import { useAnnounce } from "@/shared/a11y/useAnnounce";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import type { Announcer } from "@/shared/a11y/announcer";

/**
 * The four states an asynchronous read can be in.
 *
 * Spelled the way TanStack Query spells them, so a caller passes `query.status`
 * straight through. `"idle"` is here for the things that are not queries — a
 * form action, an XState machine — and is never announced.
 */
export type AsyncStatus = "idle" | "pending" | "success" | "error";

/**
 * What to say for each state, as strings computed during render.
 *
 * Strings rather than `(data) => string` callbacks, because the component
 * already has the data in scope and the commit that flips `status` to
 * `"success"` is the commit that has the new data in it. A callback would add a
 * generic parameter and a `TData | undefined` to every call site to buy nothing.
 *
 * `null` or `undefined` means "say nothing for this state", which is a real
 * answer and not a missing one: a list whose count is already announced by a
 * heading does not need its success narrated.
 *
 * "Loaded" on its own is not a message. What the user needs is what changed —
 * `"12 posts"`, `"no matching invoices"`, `"3 of 40 shown"` — because the point
 * of the announcement is the content, and the fact that a fetch completed is
 * only interesting as the reason they are being told.
 */
export interface AsyncStatusMessages {
  readonly pending?: string | null | undefined;
  readonly success?: string | null | undefined;
  readonly error?: string | null | undefined;
}

export interface UseAsyncStatusAnnouncementOptions {
  readonly status: AsyncStatus;
  readonly messages: AsyncStatusMessages;
  /** See {@link DEFAULT_PENDING_DELAY_MS}. */
  readonly pendingDelayMs?: number | undefined;
  /** Injected by tests; defaults to the application's announcer. */
  readonly announcer?: Announcer | undefined;
}

/**
 * How long a load has to still be running before its start is worth saying.
 *
 * Under this, the result lands first and the only thing the announcement
 * achieves is "Loading posts, 12 posts loaded" for something that took 80ms —
 * two sentences for one event, on every refetch. Over it, the user is sitting
 * in silence wondering whether their click registered, which is the case the
 * pending message exists for.
 */
const DEFAULT_PENDING_DELAY_MS = 500;

/**
 * Announces what an asynchronous read is doing, as it changes.
 *
 * ## Only transitions, and never the first one
 *
 * The status this hook sees on mount is not announced. A panel that mounts with
 * its data already cached has nothing to report — "12 posts loaded" arriving
 * unprompted on arrival is a sentence with no cause the user can connect it to,
 * and on a route change the route announcer has just said where they are. So
 * the first commit only records the status; the announcements start at the first
 * change.
 *
 * That rule is what makes the common case correct for free. A list that mounts
 * `pending` and resolves says exactly one thing — its result — and the load it
 * did on arrival is covered by the skeleton the user can already see.
 *
 * ## `status`, deliberately, and not `isFetching`
 *
 * TanStack Query keeps `status` at `"success"` through a background refetch and
 * only flips `isFetching`. Reading `status` therefore makes every refetch that
 * has data to show silent, for free: a window-focus refetch, a poll, a
 * `placeholderData` refresh. Reading `isFetching` would announce "Loading
 * posts" every time the user switched browser tabs and came back, which is both
 * useless and, at that frequency, indistinguishable from a broken page.
 *
 * The flip side is stated rather than hidden: a refetch that *fails* while
 * showing stale data moves `status` to `"error"` and is announced, which is
 * right — the user is looking at data that is no longer being kept up to date.
 *
 * ## Errors interrupt, results wait
 *
 * `error` goes to the assertive queue and `pending`/`success` to the polite one.
 * An error is the only one of the three that changes what the user should do
 * next, and interrupting them is the cost of telling them in time.
 */
export function useAsyncStatusAnnouncement({
  status,
  messages,
  pendingDelayMs = DEFAULT_PENDING_DELAY_MS,
  announcer,
}: UseAsyncStatusAnnouncementOptions): void {
  const announce = useAnnounce(announcer);
  // Read at announce time rather than captured, so the delayed pending message
  // is the current one and not the one from the commit that started the load.
  const readMessages = useStableCallback((): AsyncStatusMessages => messages);
  const previousStatusRef = useRef<AsyncStatus | null>(null);

  useEffect(() => {
    const previous = previousStatusRef.current;
    previousStatusRef.current = status;
    if (previous === null || previous === status) return undefined;

    if (status === "pending") {
      const handle = setTimeout(() => {
        const pending = readMessages().pending;
        if (pending != null) announce(pending);
      }, pendingDelayMs);
      /*
       * Cleared on the status change out of `pending`, which is the whole
       * mechanism: a load that finishes inside the delay never had an
       * announcement, rather than having one that was superseded.
       */
      return () => {
        clearTimeout(handle);
      };
    }

    if (status === "success") {
      const success = readMessages().success;
      if (success != null) announce(success);
      return undefined;
    }

    if (status === "error") {
      const error = readMessages().error;
      if (error != null) announce(error, { politeness: "assertive" });
    }

    return undefined;
  }, [status, pendingDelayMs, announce, readMessages]);
}
