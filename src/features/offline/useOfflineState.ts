import { useCallback, useSyncExternalStore } from "react";
import {
  offlineClient,
  type OfflineClient,
  type OfflineState,
} from "@/shared/offline/offlineClient";

/**
 * Subscribes a component to the offline state.
 *
 * `useSyncExternalStore` rather than `useState` in an effect, because the
 * state exists before React does: the worker can have queued writes from a
 * previous visit and the browser can already be offline when the application
 * mounts. An effect-based version renders "online, nothing pending" first and
 * corrects itself a frame later, which is a flash of wrong information in the
 * one component whose entire job is to be trusted about connectivity.
 *
 * The client is a parameter with a default rather than a context, because
 * there is exactly one worker per page and a provider would imply otherwise.
 * Tests pass their own instance.
 */
export function useOfflineState(client: OfflineClient = offlineClient): OfflineState {
  const subscribe = useCallback((listener: () => void) => client.subscribe(listener), [client]);
  const getSnapshot = useCallback(() => client.getState(), [client]);
  // The third argument is the server snapshot. This application does not
  // render on the server, and passing the same getter is what keeps the hook
  // correct if it ever does — the state it describes is client-only, and its
  // initial value is the honest answer for a document that has not hydrated.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
