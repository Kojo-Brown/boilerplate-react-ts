import { cn } from "@/shared/lib/cn";
import { offlineClient, type OfflineClient } from "@/shared/offline/offlineClient";
import { useOfflineState } from "@/features/offline/useOfflineState";

interface OfflineStatusProps {
  readonly client?: OfflineClient | undefined;
  readonly className?: string | undefined;
}

/**
 * The visible half of offline support.
 *
 * Renders nothing in the ordinary case — online, nothing queued, no update
 * waiting — because a permanent "you are online" badge is an advertisement,
 * not information. It appears for the three states a user needs to be able to
 * act on, and says which one it is rather than folding them into one
 * indicator:
 *
 * - **Offline.** The application still works; reads come from the cache and
 *   writes are held. Saying so is what stops a user from assuming the page has
 *   broken when a read is a few minutes stale.
 * - **Queued writes.** The count, because "your changes are saved" is exactly
 *   what the application must *not* imply while the writes are still in a
 *   queue that can fail.
 * - **Update ready.** A button, never an automatic reload: the new build is
 *   installed and takes effect on the next load, and choosing when that
 *   happens belongs to whoever might be halfway through a form.
 *
 * `role="status"` with `aria-live="polite"` announces changes without
 * interrupting — a connection dropping is worth saying, and not worth saying
 * over the top of whatever a screen reader is in the middle of.
 */
export function OfflineStatus({ client = offlineClient, className }: OfflineStatusProps) {
  const { online, pending, updateReady } = useOfflineState(client);

  if (online && pending === 0 && !updateReady) return null;

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

      {pending > 0 && (
        <span data-testid="offline-pending">
          {pending === 1 ? "1 change waiting to sync" : `${pending} changes waiting to sync`}
        </span>
      )}

      {updateReady && (
        <button
          type="button"
          onClick={() => {
            client.applyUpdate();
          }}
          className="ml-auto rounded-sm border border-[var(--color-border-strong)] px-2 py-1 font-medium underline-offset-2 hover:underline"
        >
          A new version is ready — reload
        </button>
      )}
    </div>
  );
}
