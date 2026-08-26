/**
 * The list algebra behind `useOptimisticList`.
 *
 * One shape of action (`create` / `update` / `delete`) is applied twice: once
 * immediately against the optimistic copy of the list, and once against the
 * committed copy when the server says what really happened. Sharing the
 * reducer is the point — if the guess and the truth were computed by different
 * code, they could disagree in ways no test would catch, because the optimistic
 * render is thrown away before anything asserts on it.
 *
 * The only difference between the two passes is `pending`: the optimistic pass
 * marks the rows it touched, the committed pass never does.
 */

/** Which kind of in-flight action put a row on screen. */
export type PendingKind = "create" | "update";

export interface OptimisticListItem {
  readonly id: string;
  /**
   * Present only while an optimistic action for this row is in flight.
   *
   * Committed rows never carry it, which is what lets the UI tell "on screen
   * because the server said so" apart from "on screen because we are guessing".
   * React drops the optimistic copy when the transition settles, so this clears
   * itself — nothing ever has to unset it.
   */
  readonly pending?: PendingKind;
}

/** The fields an `update` may change. `id` and `pending` are not among them. */
export type ListPatch<T extends OptimisticListItem> = Partial<Omit<T, "id" | "pending">>;

export type ListAction<T extends OptimisticListItem> =
  | { readonly type: "create"; readonly item: T }
  | { readonly type: "update"; readonly id: string; readonly patch: ListPatch<T> }
  | { readonly type: "delete"; readonly id: string };

/** Drops `readonly` so a copy can be edited before it is handed back as a `T`. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function merge<T extends OptimisticListItem>(item: T, patch: ListPatch<T>): T {
  return { ...item, ...patch };
}

function withPending<T extends OptimisticListItem>(item: T, pending: PendingKind): T {
  return { ...item, pending };
}

/**
 * Removes the key rather than setting it to `undefined`: under
 * `exactOptionalPropertyTypes` those are different things, and a committed row
 * carrying `pending: undefined` would still answer to `"pending" in row`.
 */
function withoutPending<T extends OptimisticListItem>(item: T): T {
  if (item.pending === undefined) return item;
  const next: Mutable<T> = { ...item };
  delete next.pending;
  return next;
}

/**
 * Applies an action the way the UI should show it *before* the server has
 * agreed, tagging the touched row so it can be rendered as provisional.
 *
 * This is the reducer handed to `useOptimistic`. React may replay it several
 * times — once per in-flight action, on top of the latest committed list — so
 * it must stay pure and must not assume it runs once per call.
 */
export function applyOptimisticAction<T extends OptimisticListItem>(
  items: readonly T[],
  action: ListAction<T>,
): T[] {
  switch (action.type) {
    case "create":
      return [...items, withPending(action.item, "create")];
    case "update":
      return items.map((item) =>
        item.id === action.id ? withPending(merge(item, action.patch), "update") : item,
      );
    case "delete":
      return items.filter((item) => item.id !== action.id);
  }
}

/**
 * Applies what the server actually did to the committed list.
 *
 * A committed `create` appends the server's row — real id, real timestamps —
 * rather than the placeholder the optimistic pass guessed with. There is no
 * duplicate to reconcile: the optimistic copy holding the placeholder is
 * discarded wholesale when the transition settles.
 */
export function applyCommittedAction<T extends OptimisticListItem>(
  items: readonly T[],
  action: ListAction<T>,
): T[] {
  switch (action.type) {
    case "create":
      return [...items, withoutPending(action.item)];
    case "update":
      return items.map((item) =>
        item.id === action.id ? withoutPending(merge(item, action.patch)) : item,
      );
    case "delete":
      return items.filter((item) => item.id !== action.id);
  }
}
