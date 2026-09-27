import { useCallback, useEffect, useState } from "react";
import {
  announcer as defaultAnnouncer,
  type AnnounceOptions,
  type Announcer,
} from "@/shared/a11y/announcer";

/** What {@link useAnnounce} returns: `announce`, scoped to the calling component. */
export type Announce = (message: string, options?: AnnounceOptions) => void;

/**
 * `announce`, bound to the component that called it.
 *
 * The binding does one thing, and it is the reason to prefer this over the bare
 * `announce` import: anything this component queued and that has not been spoken
 * yet is dropped when it unmounts. A panel that said "Loading posts" and then
 * navigated away is describing a load nobody is waiting for, and a queue that
 * kept it would speak it into the *next* page — which is worse than saying
 * nothing, because it is wrong rather than missing.
 *
 * What it cannot do is retract a message already written to a region. There is
 * no mechanism for that in any of this; speech that has started, finishes.
 */
export function useAnnounce(announcer: Announcer = defaultAnnouncer): Announce {
  /*
   * A fresh object per mount, used only for its identity. A string key would
   * collide across two instances of the same component — two lists on one page,
   * one of which unmounting would silence the other.
   *
   * `useState` rather than `useRef` because the value is read during render, to
   * build the callback below. `react-hooks/refs` rejects a ref read in render
   * and is right to: under `<StrictMode>` a ref can hold a write from a render
   * React discarded. A lazy initial state is the stable-identity-per-mount
   * primitive that is legal to read.
   */
  const [owner] = useState<object>(() => ({}));

  useEffect(() => {
    return () => {
      announcer.cancel(owner);
    };
  }, [announcer, owner]);

  return useCallback(
    (message, options) => {
      announcer.announce(message, { ...options, owner });
    },
    [announcer, owner],
  );
}
