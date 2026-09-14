import type { OfflineClient, OfflineState } from "@/shared/offline/offlineClient";

export interface StubOfflineClient extends OfflineClient {
  /** Pushes a new state to every subscriber. */
  set(next: Partial<OfflineState>): void;
  readonly updatesApplied: () => number;
  /** Live subscriber count, so a test can prove a component unsubscribed. */
  readonly listenerCount: () => number;
}

/**
 * An `OfflineClient` a test can drive directly.
 *
 * The real client is tested against a fake `ServiceWorkerContainer` in
 * `offlineClient.test.ts`; components have no business repeating that setup to
 * assert what they render for "offline with two writes queued".
 */
export function createStubOfflineClient(initial: Partial<OfflineState> = {}): StubOfflineClient {
  let state: OfflineState = { online: true, pending: 0, updateReady: false, ...initial };
  const listeners = new Set<() => void>();
  let applied = 0;

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: () => Promise.resolve(),
    applyUpdate() {
      applied += 1;
    },
    set(next) {
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
    updatesApplied: () => applied,
    listenerCount: () => listeners.size,
  };
}
