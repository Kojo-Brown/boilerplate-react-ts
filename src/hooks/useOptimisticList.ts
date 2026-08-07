import { useCallback, useOptimistic, useState, useTransition } from "react";
import {
  applyCommittedAction,
  applyOptimisticAction,
  type ListAction,
  type OptimisticListItem,
} from "@/lib/optimisticList";

export interface OptimisticMutation<T extends OptimisticListItem> {
  /** How the list should look immediately, before the server has agreed. */
  readonly optimistic: ListAction<T>;
  /**
   * Performs the real mutation and resolves with what the server actually did
   * — usually the same shape as `optimistic`, but carrying server-assigned
   * values (a real id, a normalised title) instead of guesses.
   *
   * Rejecting is how a rollback is requested: the committed list is left
   * untouched, so React re-renders from it and the optimistic row disappears.
   */
  commit: () => Promise<ListAction<T>>;
}

export interface UseOptimisticListResult<T extends OptimisticListItem> {
  /** What to render: the committed list with every in-flight action applied. */
  readonly items: readonly T[];
  /** Server truth only. Useful for asserting that a rollback really rolled back. */
  readonly committedItems: readonly T[];
  /** True while at least one mutation is in flight. */
  readonly isPending: boolean;
  /** The last rejection, or `null`. Cleared when the next mutation starts. */
  readonly error: Error | null;
  readonly clearError: () => void;
  readonly mutate: (mutation: OptimisticMutation<T>) => void;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * A list whose mutations show up instantly and undo themselves if the server
 * refuses.
 *
 * Two pieces of state, deliberately: `committed` is what the server has
 * confirmed, and `useOptimistic` layers the in-flight actions on top of it.
 * Nothing ever "undoes" an optimistic action — the rollback is the absence of a
 * commit. React discards the optimistic layer when the transition settles, so
 * a `commit()` that rejects leaves `committed` exactly as it was and the row
 * vanishes on the next render. There is no snapshot to restore and no window
 * in which a half-applied action can be observed.
 *
 * Two things about this are easy to get wrong:
 *
 * 1. **The `await` has to happen inside the transition.** React holds the
 *    optimistic layer for exactly as long as the transition is pending, so
 *    awaiting outside it (`applyOptimistic(...)` in a transition, then `await`
 *    after it) makes the optimistic row flicker in and straight back out.
 *    `mutate` keeps the whole async function inside `startTransition`.
 * 2. **Rollback is silent.** On its own, a failed mutation just removes the row
 *    the user added, with no explanation. That is why `error` exists and why
 *    the demo component renders it — an automatic rollback with no message is a
 *    bug report waiting to happen, not a finished feature.
 * 3. **Ordinary state set inside an async transition does not land when you
 *    think.** An update made synchronously inside the transition, before the
 *    first `await`, is absorbed into the transition and never renders on its
 *    own; the UI holds its old value until the action settles. Clearing the
 *    previous error in there therefore left a stale "change reverted" banner up
 *    for the whole of the *next* request. `mutate` clears it as an urgent
 *    update, outside the transition, which is why that one line sits where it
 *    does. Optimistic state is the exception — that is the entire reason
 *    `useOptimistic` exists.
 *
 * Concurrent mutations compose: React replays every in-flight optimistic action
 * over the latest committed list, and `commit` results are folded in with a
 * functional update, so two overlapping mutations cannot clobber each other.
 *
 * One consequence of React's model is worth knowing before you rely on it:
 * optimistic actions are unwound as a group, not individually. If two mutations
 * overlap and the first fails, its row stays on screen — alongside the error —
 * until the *last* in-flight action settles, at which point the whole
 * optimistic layer is discarded and the list snaps to committed truth. The end
 * state is always correct; the intermediate frame can briefly show a row that
 * has already been reported as reverted.
 *
 * `initialItems` seeds the committed list and is not read again — this hook
 * owns its state. Drive it from a `key` if the list has to be replaced.
 *
 * Usage:
 *   const { items, mutate, error, isPending } = useOptimisticList(tasks);
 *   mutate({
 *     optimistic: { type: "create", item: { id: draftId, title, done: false } },
 *     commit: async () => ({ type: "create", item: await api.create(title) }),
 *   });
 */
export function useOptimisticList<T extends OptimisticListItem>(
  initialItems: readonly T[],
): UseOptimisticListResult<T> {
  const [committedItems, setCommittedItems] = useState<readonly T[]>(initialItems);
  const [items, applyOptimistic] = useOptimistic(committedItems, applyOptimisticAction<T>);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const mutate = useCallback(
    (mutation: OptimisticMutation<T>) => {
      // Clearing the previous failure happens *outside* the transition, and
      // that placement is load-bearing — see (3) below.
      setError(null);

      // The async function lives inside the transition on purpose — see (1)
      // above. `applyOptimistic` also *requires* a transition; calling it from
      // plain event-handler scope is a React error, not a soft warning.
      startTransition(async () => {
        applyOptimistic(mutation.optimistic);
        try {
          const committedAction = await mutation.commit();
          setCommittedItems((prev) => applyCommittedAction(prev, committedAction));
        } catch (cause) {
          // Swallowed deliberately: not committing *is* the rollback, and
          // rethrowing here would surface as an unhandled rejection inside the
          // transition rather than as UI the user can read.
          setError(toError(cause));
        }
      });
    },
    [applyOptimistic],
  );

  return { items, committedItems, isPending, error, clearError, mutate };
}
