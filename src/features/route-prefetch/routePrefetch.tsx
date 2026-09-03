import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import {
  createIdleScheduler,
  createPrefetchQueue,
  type ChunkRegistry,
  type IdleScheduler,
  type PrefetchPriority,
  type PrefetchSnapshot,
  type PrefetchState,
} from "@/shared/lib/idlePrefetchQueue";
import { prefersReducedData } from "@/shared/lib/dataSaver";

/** What a link can ask of the prefetcher. */
export interface RoutePrefetchController {
  readonly request: (href: string, priority: PrefetchPriority) => void;
  readonly cancel: (href: string) => void;
  readonly stateOf: (href: string) => PrefetchState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly snapshot: () => PrefetchSnapshot;
}

const RoutePrefetchContext = createContext<RoutePrefetchController | null>(null);

export interface RoutePrefetchProviderProps {
  /**
   * Route href → the dynamic import for that route's chunk.
   *
   * Passed in rather than imported because the loaders name pages, and this
   * slice sits below them — `fsd/layer-imports` checks dynamic `import()` too,
   * so the registry can only be built where the routes are (`src/app/router/`)
   * and handed down. The same seam is what lets a test register a loader it
   * can watch instead of a real chunk.
   *
   * Must be referentially stable: a new object identity rebuilds the queue and
   * throws away everything it had already fetched.
   */
  registry: ChunkRegistry;
  children: ReactNode;
  /**
   * Whether a prefetch may be started right now, consulted per request.
   *
   * Per request rather than per mount because the answer changes: a phone
   * moving from wifi to a metered cell connection mid-session should stop
   * prefetching without the tree remounting. Cheap enough to call on every
   * hover — it is two property reads.
   */
  shouldPrefetch?: () => boolean;
  /** Overridable for tests, which supply the deadline the queue gates on. */
  scheduler?: IdleScheduler;
}

function defaultShouldPrefetch(): boolean {
  return !prefersReducedData();
}

export function RoutePrefetchProvider({
  registry,
  children,
  shouldPrefetch = defaultShouldPrefetch,
  scheduler,
}: RoutePrefetchProviderProps) {
  const queue = useMemo(
    () => createPrefetchQueue({ registry, scheduler: scheduler ?? createIdleScheduler() }),
    [registry, scheduler],
  );

  // `activate()` returns its own teardown, so the effect cannot pair the wrong
  // one — and unlike a `dispose()` here, the teardown is reversible. It has to
  // be: StrictMode mounts, runs effects, runs cleanups, then mounts again, so
  // an irreversible teardown would kill prefetching on the first commit in
  // development, silently and only in development. See `PrefetchQueue.activate`.
  useEffect(() => queue.activate(), [queue]);

  const controller = useMemo<RoutePrefetchController>(
    () => ({
      request(href, priority) {
        if (!shouldPrefetch()) return;
        queue.request(href, priority);
      },
      // Not gated: withdrawing a request must work even if the answer to
      // "may we prefetch" has flipped to no since it was made.
      cancel: (href) => {
        queue.cancel(href);
      },
      stateOf: (href) => queue.stateOf(href),
      subscribe: (listener) => queue.subscribe(listener),
      snapshot: () => queue.snapshot(),
    }),
    [queue, shouldPrefetch],
  );

  return (
    <RoutePrefetchContext.Provider value={controller}>{children}</RoutePrefetchContext.Provider>
  );
}

/**
 * The prefetch controller for the tree.
 *
 * Throws when there is no provider rather than degrading to a no-op. A missing
 * prefetcher has no symptom — every page still loads, just at the moment it
 * was always going to — so the silent version would be indistinguishable from
 * the feature working, in tests and in the app alike.
 */
export function useRoutePrefetch(): RoutePrefetchController {
  const controller = useContext(RoutePrefetchContext);
  if (controller === null) {
    throw new Error("useRoutePrefetch must be used within a <RoutePrefetchProvider>");
  }
  return controller;
}
