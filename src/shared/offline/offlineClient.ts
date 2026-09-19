import { parseWorkerMessage, type ReplayedWrite } from "@/shared/offline/messages";
import {
  activateUpdate,
  postToServiceWorker,
  registerServiceWorker,
  reloadOnControllerChange,
  type ServiceWorkerContainerLike,
  type ServiceWorkerRegistrationLike,
} from "@/shared/offline/registerServiceWorker";

/**
 * Writes that are never going to be sent.
 *
 * Two fields rather than one list because the list can be incomplete and the
 * count cannot. A worker from the previous build reports how many writes it
 * abandoned without saying which — see `writes` in `messages.ts` — and the
 * number is the part a user must not be denied. Rendering `writes.length`
 * would report a silent zero in exactly that case, which is the failure this
 * whole field exists to prevent: an application that quietly loses a write is
 * worse than one that fails in front of the user.
 *
 * So `count >= writes.length`, always, and the interface says the count and
 * lists what it has.
 */
export interface UnsentWrites {
  readonly count: number;
  readonly writes: readonly ReplayedWrite[];
}

const NOTHING_UNSENT: UnsentWrites = { count: 0, writes: [] };

/**
 * What the interface may say about the offline state.
 *
 * Five facts, and the reason each of them is here is that the user can
 * otherwise only find it out by being surprised:
 *
 * - **`online`** — the browser's own flag, which is famously optimistic: it
 *   means "an interface is up", not "requests succeed". It is still the only
 *   signal available before a request fails, and it is the one a user
 *   recognises.
 * - **`pending`** — writes the worker is holding. Without a number here, an
 *   application that queues writes is one that appears to save and does
 *   nothing, which is worse than one that fails loudly.
 * - **`syncing`** — a replay pass the page asked for is in flight. Distinct
 *   from `pending > 0` and not derivable from it: "three changes waiting"
 *   describes both the tunnel and the ten seconds after it, and only one of
 *   those is a state where waiting is the right thing for the user to do.
 * - **`unsent`** — writes that have left the queue without being delivered.
 *   The only state in the whole design where a user believes something was
 *   saved and nothing was, so it is the only one that persists until
 *   acknowledged.
 * - **`updateReady`** — a new build is installed and waiting. Deliberately
 *   surfaced rather than applied: taking it requires reloading the page, and a
 *   reload the user did not ask for is a reload that can discard what they
 *   were typing.
 */
export interface OfflineState {
  readonly online: boolean;
  readonly pending: number;
  readonly syncing: boolean;
  readonly unsent: UnsentWrites;
  readonly updateReady: boolean;
}

/** One completed replay pass, as the application's caches need to hear about it. */
export interface ReplayEvent {
  readonly sent: number;
  readonly dropped: number;
  /** `null` from a worker that reports counts only — see `messages.ts`. */
  readonly writes: readonly ReplayedWrite[] | null;
  readonly pending: number;
}

export interface StartOptions {
  /** `null` where service workers are unavailable — the client then tracks connectivity only. */
  readonly container: ServiceWorkerContainerLike | null;
  readonly isOnline: () => boolean;
  /** Subscribes to a connectivity event; returns nothing, because nothing here unsubscribes. */
  readonly listen: (type: "online" | "offline", listener: () => void) => void;
  readonly reload: () => void;
  readonly scriptUrl?: string;
}

export interface OfflineClient {
  getState(): OfflineState;
  subscribe(listener: () => void): () => void;
  start(options: StartOptions): Promise<void>;
  /** Takes a waiting update. The page reloads when the new worker takes over. */
  applyUpdate(): void;
  /**
   * Fires once per replay pass the worker reports.
   *
   * Separate from {@link subscribe} because the two answer different
   * questions. A state subscription says what to render *now*, and a
   * re-render is idempotent; a replay is an event, and the invalidation it
   * triggers must happen exactly once. Deriving "a replay just finished" by
   * diffing two snapshots is possible and wrong in the ordinary case — two
   * passes that both send one write leave `pending` at zero both times, so the
   * second is invisible.
   */
  onReplay(listener: (event: ReplayEvent) => void): () => void;
  /**
   * Asks the worker to drain the queue now, ignoring the backoff.
   *
   * The same request the `online` event makes, exposed so a user can make it.
   * Worth a button: a queue whose head has failed four times is five minutes
   * from its next attempt, and a user looking at "2 changes waiting to sync"
   * on a connection that visibly works has information the schedule does not.
   *
   * Returns whether the worker could be reached at all, so the interface can
   * decline to offer a button that would do nothing.
   */
  replayNow(): boolean;
  /** Acknowledges the abandoned writes, clearing the notice. */
  dismissUnsent(): void;
}

/**
 * The page-side offline state, as an external store.
 *
 * An external store rather than React state because the events that change it
 * — a `message` from the worker, `online`, `offline` — arrive from outside
 * React and before any component has mounted. `useSyncExternalStore` is built
 * for exactly this: one subscription shared by every consumer, and a snapshot
 * that is already correct on first render rather than filled in by an effect.
 *
 * Created by a factory with no hidden globals so a test can run several at
 * once; `src/app/main.tsx` starts the single instance the application uses.
 */
export function createOfflineClient(): OfflineClient {
  let state: OfflineState = {
    online: true,
    pending: 0,
    syncing: false,
    unsent: NOTHING_UNSENT,
    updateReady: false,
  };
  const listeners = new Set<() => void>();
  const replayListeners = new Set<(event: ReplayEvent) => void>();
  let registration: ServiceWorkerRegistrationLike | null = null;
  let container: ServiceWorkerContainerLike | null = null;

  function setState(next: Partial<OfflineState>): void {
    const merged = { ...state, ...next };
    if (
      merged.online === state.online &&
      merged.pending === state.pending &&
      merged.syncing === state.syncing &&
      // Compared by identity, which is sound because the only writer below
      // replaces the object rather than mutating it. Comparing the lists
      // element-wise would cost more and could never disagree.
      merged.unsent === state.unsent &&
      merged.updateReady === state.updateReady
    ) {
      // `useSyncExternalStore` compares snapshots by identity and re-renders
      // on every change of it. Returning a new object for an unchanged state
      // is how a store makes React render forever.
      return;
    }
    state = merged;
    for (const listener of listeners) listener();
  }

  /** Asks for a drain, and records that one is in flight if the ask landed. */
  function requestReplay(): boolean {
    if (container === null) return false;
    const asked = postToServiceWorker(container, { type: "REPLAY_QUEUE" });
    // Only on a delivered message. Setting it unconditionally would leave a
    // page with no controller — the first visit, before the worker claims it —
    // showing "syncing" with nothing on the other end to ever say otherwise.
    if (asked) setState({ syncing: true });
    return asked;
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onReplay(listener) {
      replayListeners.add(listener);
      return () => replayListeners.delete(listener);
    },

    async start(options) {
      setState({ online: options.isOnline() });

      options.listen("offline", () => {
        // `syncing` is cleared here rather than left to the worker's answer: a
        // connection that drops mid-replay produces no `QUEUE_REPLAYED` at all
        // for the entries behind the one that failed, and a spinner that
        // outlives the network is the one thing worse than no spinner.
        setState({ online: false, syncing: false });
      });
      options.listen("online", () => {
        setState({ online: true });
        // The browser's own Background Sync may not exist (Safari, Firefox) or
        // may be minutes away. A page that has just seen the network return is
        // the most reliable trigger there is, so it asks directly.
        requestReplay();
      });

      if (options.container === null) return;
      container = options.container;

      container.addEventListener("message", (event) => {
        const message = parseWorkerMessage(event.data);
        if (message === null) return;
        if (message.type === "QUEUE_STATUS") {
          setState({ pending: message.pending });
          return;
        }

        const dropped = message.writes?.filter((write) => write.fate !== "sent") ?? [];
        setState({
          pending: message.pending,
          syncing: false,
          // Accumulated across passes, never replaced: an entry is reported
          // once, at the moment it leaves the queue, so a second pass carries
          // nothing about the first one's losses. Rebuilding the list from the
          // latest message would erase them.
          ...(message.dropped > 0
            ? {
                unsent: {
                  count: state.unsent.count + message.dropped,
                  writes: [...state.unsent.writes, ...dropped],
                },
              }
            : {}),
        });
        for (const listener of replayListeners) {
          listener({
            sent: message.sent,
            dropped: message.dropped,
            writes: message.writes,
            pending: message.pending,
          });
        }
      });

      reloadOnControllerChange(container, options.reload);

      registration = await registerServiceWorker({
        container,
        ...(options.scriptUrl !== undefined ? { scriptUrl: options.scriptUrl } : {}),
        onUpdateReady: () => {
          setState({ updateReady: true });
        },
      });

      // Seeds the count from whatever the worker is already holding: a queue
      // filled during a previous visit is invisible otherwise, because the
      // worker only announces changes.
      postToServiceWorker(container, { type: "QUEUE_STATUS" });
    },

    applyUpdate() {
      if (registration !== null) activateUpdate(registration);
    },

    replayNow: requestReplay,

    dismissUnsent() {
      setState({ unsent: NOTHING_UNSENT });
    },
  };
}

/** The instance the application uses; started by `src/app/main.tsx`. */
export const offlineClient = createOfflineClient();
