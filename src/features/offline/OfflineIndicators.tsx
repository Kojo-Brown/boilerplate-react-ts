import { offlineClient, type OfflineClient } from "@/shared/offline/offlineClient";
import { useOfflineState } from "@/features/offline/useOfflineState";
import { OfflineStatus } from "@/features/offline/OfflineStatus";
import { UnsentWritesNotice } from "@/features/offline/UnsentWritesNotice";

interface OfflineIndicatorsProps {
  readonly client?: OfflineClient | undefined;
  readonly className?: string | undefined;
}

/**
 * Everything offline support puts on the screen, from **one** subscription.
 *
 * The two indicators below are deliberately separate components — a polite
 * `role="status"` for connectivity and an assertive `role="alert"` for writes
 * that were lost — and it would be natural for each to read the offline state
 * itself. That version was written, and it cost more than it looks like it
 * should: `e2e/concurrency-benchmark.spec.ts` measures worst keypress-to-paint
 * while a deferred 15,000-row list re-filters, and adding a second
 * `useSyncExternalStore` subscriber to the shell moved it from ~96ms to ~250ms
 * — enough to fail the benchmark's assertion that the blocking arm is at least
 * twice as slow as the concurrent one.
 *
 * The mechanism is that reading an external store during a concurrent render
 * is what React cannot time-slice: it has to re-read every subscribed
 * snapshot before it commits, to be sure no two of them saw different values.
 * A store read in the shell is therefore paid for by every deferred update
 * beneath it, and the shell is the worst place in the tree to put a second
 * one — it is above every route.
 *
 * So the subscription is here, once, and the indicators take what they render.
 * They are better components for it: given a state and a callback, neither can
 * observe anything it does not display, and their tests hand them a state
 * rather than building a client.
 */
export function OfflineIndicators({ client = offlineClient, className }: OfflineIndicatorsProps) {
  const state = useOfflineState(client);

  return (
    <>
      <OfflineStatus
        state={state}
        onReplayNow={() => {
          client.replayNow();
        }}
        onApplyUpdate={() => {
          client.applyUpdate();
        }}
        {...(className !== undefined ? { className } : {})}
      />
      <UnsentWritesNotice
        unsent={state.unsent}
        onDismiss={() => {
          client.dismissUnsent();
        }}
        {...(className !== undefined ? { className } : {})}
      />
    </>
  );
}
