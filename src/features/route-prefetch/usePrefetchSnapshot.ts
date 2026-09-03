import { useSyncExternalStore } from "react";
import type { PrefetchSnapshot } from "@/shared/lib/idlePrefetchQueue";
import { useRoutePrefetch } from "@/features/route-prefetch/routePrefetch";

/**
 * What the queue is doing right now, as React state.
 *
 * `useSyncExternalStore` rather than an effect-plus-`useState` mirror: the
 * queue is mutated from an idle callback and from promise continuations,
 * neither of which is a React event, so a mirror would tear under concurrent
 * rendering — two components reading the same queue in one pass could commit
 * different answers. The snapshot is cached inside the queue and invalidated
 * only when something changes, which is the identity stability this hook
 * requires: returning a fresh array here would re-render forever.
 *
 * Its own module because `routePrefetch.tsx` exports a component, and
 * `react-refresh/only-export-components` is what keeps that provider from
 * remounting — and remounting the provider would discard the queue.
 */
export function usePrefetchSnapshot(): PrefetchSnapshot {
  const { subscribe, snapshot } = useRoutePrefetch();
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
