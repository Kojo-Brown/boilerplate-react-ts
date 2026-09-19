import { cn } from "@/shared/lib/cn";
import type { UnsentWrites } from "@/shared/offline/offlineClient";
import { describeFate, describeWrite } from "@/features/offline/describeWrite";

interface UnsentWritesNoticeProps {
  readonly unsent: UnsentWrites;
  /** Acknowledges the loss. Nothing else clears this notice. */
  readonly onDismiss: () => void;
  readonly className?: string | undefined;
}

/**
 * The one offline state that is a loss rather than a delay.
 *
 * Every other state in this feature resolves on its own: offline becomes
 * online, queued becomes sent, an update waits until someone reloads. A write
 * that left the queue undelivered resolves into nothing. The user made a
 * change, the interface accepted it — a `202`, an optimistic row, a form that
 * cleared — and the server never heard about it. Nothing downstream will ever
 * correct that; the queue is the last component that knew, and this is where
 * it says so.
 *
 * Three decisions follow from that and none of them match `<OfflineStatus>`:
 *
 * - **A separate live region, and an assertive one.** `role="alert"`
 *   interrupts, which is normally rude and is right here: a connectivity
 *   change is something to mention when convenient, and "the thing you saved
 *   was not saved" is something to say now. Folding it into the polite status
 *   region would also mean one region changing between two urgencies, which
 *   assistive technology has no way to convey.
 * - **It persists until acknowledged.** There is no timeout and no auto-clear.
 *   A notice about lost work that disappears while the user is looking
 *   elsewhere has lost the work twice.
 * - **It counts, and lists what it can.** `count` can exceed the number of
 *   rows — a worker from a previous build reports how many it abandoned and
 *   not which — so the heading is driven by the count and the list by whatever
 *   detail arrived. Rendering the list's length would report a confident zero
 *   in exactly the case where something was lost.
 *
 * Presentational, like `<OfflineStatus>`: the shell's one subscription lives in
 * `<OfflineIndicators>`.
 */
export function UnsentWritesNotice({ unsent, onDismiss, className }: UnsentWritesNoticeProps) {
  if (unsent.count === 0) return null;

  return (
    <div
      role="alert"
      data-testid="offline-unsent"
      className={cn(
        "rounded-md border border-[var(--color-danger)] bg-[var(--color-danger-subtle)] px-3 py-2 text-sm text-[var(--color-fg)]",
        className,
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <p className="font-medium">
          {unsent.count === 1
            ? "1 change could not be saved"
            : `${String(unsent.count)} changes could not be saved`}
          . Your work is still on this device only — please try again.
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-auto rounded-sm border border-[var(--color-danger)] px-2 py-1 font-medium underline-offset-2 hover:underline"
        >
          Dismiss
        </button>
      </div>

      {unsent.writes.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {unsent.writes.map((write, index) => (
            // The index is part of the key because the queue can legitimately
            // hold two identical requests — a user who pressed Save twice —
            // and they are two lost changes, not one rendered twice.
            <li key={`${write.method}:${write.url}:${String(index)}`}>
              <code className="font-mono text-xs">{describeWrite(write)}</code>{" "}
              {describeFate(write)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
