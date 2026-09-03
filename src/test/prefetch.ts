import { act } from "@testing-library/react";
import type { IdleScheduler } from "@/shared/lib/idlePrefetchQueue";

/** One `scheduler.request(...)` still waiting to be run. */
export interface PendingIdleCallback {
  readonly handle: number;
  readonly cancelled: boolean;
}

export interface ManualIdleScheduler extends IdleScheduler {
  /** Callbacks requested since install, oldest first. */
  readonly requests: readonly PendingIdleCallback[];
  /** Requested, not yet run, not cancelled. */
  readonly pendingCount: () => number;
  /**
   * Run every waiting callback with a deadline reporting `timeRemainingMs`.
   *
   * Wrapped in `act` so the renders a dispatch causes are flushed. Returns the
   * number of callbacks that actually ran, which is how a test tells "the
   * queue was saturated so nothing was scheduled" apart from "the callback ran
   * and chose not to dispatch".
   */
  readonly flush: (timeRemainingMs?: number) => number;
}

const GENEROUS_IDLE_MS = 50;

/**
 * A `requestIdleCallback` a test drives by hand.
 *
 * jsdom implements neither `requestIdleCallback` nor anything that could
 * decide when the main thread is free, so this is not a polyfill: it records
 * what was requested and lets the test say both *when* the browser goes idle
 * and *how much slack it reports*. Both halves matter — the second is the only
 * way to exercise the gate in `createPrefetchQueue`, since a real deadline
 * cannot be asked to be nearly exhausted on demand.
 *
 * Cancelled handles are kept in `requests` rather than removed, so a test can
 * assert that a withdrawn hover actually cancelled its callback instead of
 * merely never having made one.
 */
export function createManualIdleScheduler(): ManualIdleScheduler {
  interface Entry {
    handle: number;
    callback: (deadline: { timeRemaining(): number }) => void;
    cancelled: boolean;
    ran: boolean;
  }

  const entries: Entry[] = [];
  let nextHandle = 1;

  return {
    request(callback) {
      const handle = nextHandle++;
      entries.push({ handle, callback, cancelled: false, ran: false });
      return handle;
    },

    cancel(handle) {
      const entry = entries.find((e) => e.handle === handle);
      if (entry) entry.cancelled = true;
    },

    get requests() {
      return entries.map(({ handle, cancelled }) => ({ handle, cancelled }));
    },

    pendingCount() {
      return entries.filter((e) => !e.cancelled && !e.ran).length;
    },

    flush(timeRemainingMs = GENEROUS_IDLE_MS) {
      // Snapshotted first: a callback that dispatches will schedule the next
      // one synchronously, and running that in the same flush would make one
      // call drain the entire queue — the very behaviour the budget exists to
      // prevent, hidden by the harness.
      const due = entries.filter((e) => !e.cancelled && !e.ran);
      let ran = 0;
      act(() => {
        for (const entry of due) {
          entry.ran = true;
          entry.callback({ timeRemaining: () => timeRemainingMs });
          ran += 1;
        }
      });
      return ran;
    },
  };
}

/**
 * A registry whose loaders resolve when the test says so.
 *
 * `import()` in a unit test would load a real page module, which is both slow
 * and the wrong thing under assertion — what matters is *whether and when* a
 * loader was called, not what it returned.
 */
export interface StubChunkRegistry {
  readonly registry: Readonly<Record<string, () => Promise<unknown>>>;
  /** Hrefs whose loader has been called, in call order. Duplicates kept. */
  readonly calls: readonly string[];
  /** Resolve the outstanding load for `href`. */
  readonly resolve: (href: string) => Promise<void>;
  /** Reject it, as a chunk request that failed. */
  readonly reject: (href: string, reason?: Error) => Promise<void>;
}

export function createStubChunkRegistry(hrefs: readonly string[]): StubChunkRegistry {
  const calls: string[] = [];
  const settlers = new Map<string, { resolve: () => void; reject: (reason: Error) => void }>();

  const registry: Record<string, () => Promise<unknown>> = {};
  for (const href of hrefs) {
    registry[href] = () => {
      calls.push(href);
      return new Promise<void>((resolve, reject) => {
        settlers.set(href, { resolve, reject });
      });
    };
  }

  async function settle(
    href: string,
    run: (s: { resolve: () => void; reject: (r: Error) => void }) => void,
  ) {
    const settler = settlers.get(href);
    if (settler === undefined) throw new Error(`No outstanding load for ${href}`);
    settlers.delete(href);
    run(settler);
    // Two turns: one for the loader's own promise, one for the `.then` the
    // queue attached to it. Wrapped in `act` because settling can dispatch the
    // next entry and re-render anything watching the snapshot.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  return {
    registry,
    get calls() {
      return [...calls];
    },
    resolve: (href) =>
      settle(href, (s) => {
        s.resolve();
      }),
    reject: (href, reason = new Error(`chunk failed: ${href}`)) =>
      settle(href, (s) => {
        s.reject(reason);
      }),
  };
}
