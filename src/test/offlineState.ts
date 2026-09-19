import type { OfflineClient, OfflineState, ReplayEvent } from "@/shared/offline/offlineClient";

export interface StubOfflineClient extends OfflineClient {
  /** Pushes a new state to every subscriber. */
  set(next: Partial<OfflineState>): void;
  readonly updatesApplied: () => number;
  /** Live subscriber count, so a test can prove a component unsubscribed. */
  readonly listenerCount: () => number;
  /** How many times the interface asked for a replay. */
  readonly replaysRequested: () => number;
  /** How many times the interface acknowledged the abandoned writes. */
  readonly dismissals: () => number;
  /** Delivers a replay event to whatever `onReplay` listeners are attached. */
  emitReplay(event: ReplayEvent): void;
}

/**
 * An `OfflineClient` a test can drive directly.
 *
 * The real client is tested against a fake `ServiceWorkerContainer` in
 * `offlineClient.test.ts`; components have no business repeating that setup to
 * assert what they render for "offline with two writes queued".
 */
export function createStubOfflineClient(initial: Partial<OfflineState> = {}): StubOfflineClient {
  let state: OfflineState = {
    online: true,
    pending: 0,
    syncing: false,
    unsent: { count: 0, writes: [] },
    updateReady: false,
    ...initial,
  };
  const listeners = new Set<() => void>();
  const replayListeners = new Set<(event: ReplayEvent) => void>();
  let applied = 0;
  let replays = 0;
  let dismissed = 0;

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
    start: () => Promise.resolve(),
    applyUpdate() {
      applied += 1;
    },
    replayNow() {
      replays += 1;
      return true;
    },
    dismissUnsent() {
      dismissed += 1;
      this.set({ unsent: { count: 0, writes: [] } });
    },
    set(next) {
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
    emitReplay(event) {
      for (const listener of replayListeners) listener(event);
    },
    updatesApplied: () => applied,
    listenerCount: () => listeners.size,
    replaysRequested: () => replays,
    dismissals: () => dismissed,
  };
}
