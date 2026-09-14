import { parseWorkerMessage } from "@/shared/offline/messages";
import {
  activateUpdate,
  postToServiceWorker,
  registerServiceWorker,
  reloadOnControllerChange,
  type ServiceWorkerContainerLike,
  type ServiceWorkerRegistrationLike,
} from "@/shared/offline/registerServiceWorker";

/**
 * What the interface may say about the offline state.
 *
 * Three facts, and the reason each of them is here is that the user can
 * otherwise only find it out by being surprised:
 *
 * - **`online`** — the browser's own flag, which is famously optimistic: it
 *   means "an interface is up", not "requests succeed". It is still the only
 *   signal available before a request fails, and it is the one a user
 *   recognises.
 * - **`pending`** — writes the worker is holding. Without a number here, an
 *   application that queues writes is one that appears to save and does
 *   nothing, which is worse than one that fails loudly.
 * - **`updateReady`** — a new build is installed and waiting. Deliberately
 *   surfaced rather than applied: taking it requires reloading the page, and a
 *   reload the user did not ask for is a reload that can discard what they
 *   were typing.
 */
export interface OfflineState {
  readonly online: boolean;
  readonly pending: number;
  readonly updateReady: boolean;
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
  let state: OfflineState = { online: true, pending: 0, updateReady: false };
  const listeners = new Set<() => void>();
  let registration: ServiceWorkerRegistrationLike | null = null;
  let container: ServiceWorkerContainerLike | null = null;

  function setState(next: Partial<OfflineState>): void {
    const merged = { ...state, ...next };
    if (
      merged.online === state.online &&
      merged.pending === state.pending &&
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

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async start(options) {
      setState({ online: options.isOnline() });

      options.listen("offline", () => {
        setState({ online: false });
      });
      options.listen("online", () => {
        setState({ online: true });
        // The browser's own Background Sync may not exist (Safari, Firefox) or
        // may be minutes away. A page that has just seen the network return is
        // the most reliable trigger there is, so it asks directly.
        if (container !== null) postToServiceWorker(container, { type: "REPLAY_QUEUE" });
      });

      if (options.container === null) return;
      container = options.container;

      container.addEventListener("message", (event) => {
        const message = parseWorkerMessage(event.data);
        if (message !== null) setState({ pending: message.pending });
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
  };
}

/** The instance the application uses; started by `src/app/main.tsx`. */
export const offlineClient = createOfflineClient();
