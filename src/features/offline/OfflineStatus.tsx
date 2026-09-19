import { cn } from "@/shared/lib/cn";
import type { OfflineState } from "@/shared/offline/offlineClient";

interface OfflineStatusProps {
  readonly state: OfflineState;
  /** Asks the worker to drain the queue now, ignoring the backoff. */
  readonly onReplayNow: () => void;
  readonly onApplyUpdate: () => void;
  readonly className?: string | undefined;
}

/**
 * The visible half of offline support: connectivity, and the queue behind it.
 *
 * Presentational — it takes the state rather than subscribing to it. The
 * subscription is `<OfflineIndicators>`'s, and there is exactly one for the
 * whole shell because a second one is measurably not free; see that file.
 *
 * Renders nothing in the ordinary case — online, nothing queued, nothing
 * syncing, no update waiting — because a permanent "you are online" badge is
 * an advertisement, not information. It appears for the states a user needs to
 * be able to act on, and says which one it is rather than folding them into
 * one indicator:
 *
 * - **Offline.** The application still works; reads come from the cache and
 *   writes are held. Saying so is what stops a user from assuming the page has
 *   broken when a read is a few minutes stale.
 * - **Queued writes.** The count, because "your changes are saved" is exactly
 *   what the application must *not* imply while the writes are still in a
 *   queue that can fail.
 * - **Syncing.** Distinct from the count, and not derivable from it. "Three
 *   changes waiting" is true in the tunnel and true for the ten seconds after
 *   it, and only one of those is a state where the right thing for the user to
 *   do is wait.
 * - **Update ready.** A button, never an automatic reload: the new build is
 *   installed and takes effect on the next load, and choosing when that
 *   happens belongs to whoever might be halfway through a form.
 *
 * **Success is not announced**, deliberately. When a replay drains the queue
 * the banner disappears and the reconciled data arrives underneath it, which
 * is the feedback — a "3 changes synced" toast on top of that is a second
 * notification for an outcome the user can already see, and it trains people
 * to dismiss the banner that matters. Writes that were *not* sent are a
 * different component, `<UnsentWritesNotice>`, because they are a different
 * urgency and belong in a different live region.
 *
 * `role="status"` with `aria-live="polite"` announces changes without
 * interrupting — a connection dropping is worth saying, and not worth saying
 * over the top of whatever a screen reader is in the middle of.
 */
export function OfflineStatus({
  state,
  onReplayNow,
  onApplyUpdate,
  className,
}: OfflineStatusProps) {
  const { online, pending, syncing, updateReady } = state;

  if (online && pending === 0 && !syncing && !updateReady) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm",
        online
          ? "border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-fg)]"
          : "border-[var(--color-warning)] bg-[var(--color-warning-subtle)] text-[var(--color-warning-fg)]",
        className,
      )}
    >
      {!online && <span className="font-medium">Offline — showing saved data</span>}

      {syncing ? (
        <span data-testid="offline-syncing">Sending your changes…</span>
      ) : (
        pending > 0 && (
          <span data-testid="offline-pending">
            {pending === 1
              ? "1 change waiting to sync"
              : `${String(pending)} changes waiting to sync`}
          </span>
        )
      )}

      {/*
        Offered only where it can do something. The queue backs off after a
        failure — five minutes, eventually — and a user looking at a stalled
        count on a connection that visibly works knows something the schedule
        does not, so the button is worth having. It is withheld while offline
        (there is nothing to send it over) and while a pass is already in
        flight (a second request would only reset the label).
      */}
      {online && pending > 0 && !syncing && (
        <button
          type="button"
          onClick={onReplayNow}
          className="rounded-sm border border-[var(--color-border-strong)] px-2 py-1 font-medium underline-offset-2 hover:underline"
        >
          Try now
        </button>
      )}

      {updateReady && (
        <button
          type="button"
          onClick={onApplyUpdate}
          className="ml-auto rounded-sm border border-[var(--color-border-strong)] px-2 py-1 font-medium underline-offset-2 hover:underline"
        >
          A new version is ready — reload
        </button>
      )}
    </div>
  );
}
