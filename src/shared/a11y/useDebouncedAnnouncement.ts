import { useEffect, useRef } from "react";
import { useAnnounce } from "@/shared/a11y/useAnnounce";
import type { Announcer, Politeness } from "@/shared/a11y/announcer";

export interface UseDebouncedAnnouncementOptions {
  /** See {@link DEFAULT_DEBOUNCE_MS}. */
  readonly delayMs?: number | undefined;
  /** Defaults to `"polite"`. A debounced interruption is a contradiction. */
  readonly politeness?: Politeness | undefined;
  /** Injected by tests; defaults to the application's announcer. */
  readonly announcer?: Announcer | undefined;
}

/**
 * Long enough to cover the gap between two keystrokes of ordinary typing, so a
 * word produces one announcement rather than one per letter.
 *
 * This is a different number from the async-status hook's delay even though both
 * are "wait and see", because they are waiting for opposite things. That one
 * waits to find out whether an announcement is *needed at all*; this one knows
 * it is needed and is waiting for the value to stop moving.
 */
const DEFAULT_DEBOUNCE_MS = 500;

/**
 * Announces `message` once it has stopped changing.
 *
 * For the live regions that describe a *result set* rather than an event: how
 * many suggestions a combobox is offering, how many rows a filter left. Those
 * change on every keystroke, and announcing each one means a screen-reader user
 * types into a running commentary — six letters, six sentences, each cutting off
 * the last, and the only one that mattered is the one they would have got by
 * saying nothing until they stopped.
 *
 * `null` means there is nothing to say, and withdraws any announcement still
 * waiting: a popup that closes before the debounce elapses should not then
 * describe itself.
 *
 * The wait restarts when the *message* changes, not on every render. Two
 * keystrokes that leave the same count therefore do not postpone it: the fact
 * has been continuously true for the whole delay, and withholding it further
 * would mean a user who keeps typing without changing the result never hears
 * anything. It also means a component re-rendering for unrelated reasons cannot
 * silence it.
 *
 * The value present on mount is not announced, for the reason
 * `useAsyncStatusAnnouncement` does not announce its first status — a component
 * appearing and immediately narrating its own contents is a sentence with no
 * cause. Only changes are announced.
 */
export function useDebouncedAnnouncement(
  message: string | null,
  { delayMs = DEFAULT_DEBOUNCE_MS, politeness, announcer }: UseDebouncedAnnouncementOptions = {},
): void {
  const announce = useAnnounce(announcer);
  const isFirstRef = useRef(true);

  useEffect(() => {
    if (isFirstRef.current) {
      isFirstRef.current = false;
      return undefined;
    }
    if (message === null) return undefined;

    const handle = setTimeout(() => {
      announce(message, { politeness });
    }, delayMs);
    return () => {
      clearTimeout(handle);
    };
  }, [message, delayMs, politeness, announce]);
}
