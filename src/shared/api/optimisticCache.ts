import {
  hashKey,
  matchQuery,
  type QueryCacheNotifyEvent,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

/**
 * Optimistic writes into the TanStack Query cache, with rollback that survives
 * overlapping mutations.
 *
 * The recipe everybody starts from is snapshot-and-restore: `onMutate` reads
 * the current cache entry, writes a guess over it and returns the snapshot;
 * `onError` writes the snapshot back. It is three lines and it is right for one
 * mutation at a time. Two things break it, and both are ordinary:
 *
 * 1. **A second mutation overlaps the first.** B snapshots a cache that already
 *    contains A's guess, so rolling B back keeps A — fine. Rolling *A* back
 *    restores a snapshot taken before B existed, so B's row disappears while
 *    B is still in flight, and comes back only when B settles. The snapshot is
 *    a photograph of a moment that has since been overwritten.
 * 2. **Something refetches while the guess is up.** `cancelQueries` covers the
 *    fetches that are already running at `onMutate`, and nothing covers the
 *    ones that start afterwards — a window refocus, a remount, an interval,
 *    another mutation's invalidation. That response lands as server truth and
 *    silently erases the optimistic row.
 *
 * So this module does not keep snapshots of the *cache*. It keeps the server's
 * last word per entry (`base`) and an ordered list of the guesses currently
 * in flight (`patches`), and treats what the cache shows as derived:
 *
 *     cache = patches.reduce(apply, base)
 *
 * Every event re-derives rather than restores. A rollback removes one patch
 * from the middle of the list and re-runs the rest, so B survives A's failure.
 * A refetch that lands mid-flight replaces `base` and the guesses are re-applied
 * on top of it, so the response updates everything the mutation did not touch
 * without erasing what it did. Neither one is a special case — they are the same
 * line of code.
 *
 * The `base`/`patch` split is also what removes the flicker at the end. A
 * successful mutation does not drop its guess when the request resolves; it
 * marks it confirmed and keeps it applied until the scope's invalidation has
 * refetched, at which point `base` *is* the change and dropping the patch shows
 * no movement. Dropping it any earlier shows the row vanish and return.
 *
 * See `docs/optimistic-cache.md` for the prose version, and
 * `useOptimisticMutation.ts` for the hook almost everything should use instead
 * of calling this directly.
 */

/**
 * A guess about what one cache entry will look like once the server agrees.
 *
 * It is handed the entry's own key because the scope covers several of them and
 * the right guess differs between them: marking a task done adds a row to
 * `["tasks", "list", "done"]` and removes one from `["tasks", "list", "open"]`.
 * A patch that ignored the key could only ever write the same edit everywhere,
 * which is correct exactly when no cached view filters anything.
 */
export type OptimisticPatch<TData> = (previous: TData, queryKey: QueryKey) => TData;

/** How a mutation ended, as far as the cache is concerned. */
export type OptimisticOutcome = "success" | "error";

export interface OptimisticScopeOptions {
  /**
   * Prefix naming every cache entry the patch rewrites.
   *
   * A prefix rather than one key because a list is usually cached several times
   * over — `["tasks", "list", "open"]` and `["tasks", "list", "done"]` are two
   * entries holding the same rows under different questions, and a mutation
   * that patches one and not the other has made the screen disagree with
   * itself. Entries are matched the way `invalidateQueries` matches them.
   */
  readonly queryKey: QueryKey;
  /**
   * Keys to invalidate once every mutation in the scope has settled.
   *
   * These are the queries whose answer the mutation changed but whose new value
   * this client cannot compute — a server-side aggregate, a search ranking, a
   * permissions list. Defaults to `[queryKey]`, which resyncs the patched
   * entries themselves and nothing else.
   */
  readonly invalidateKeys?: readonly QueryKey[] | undefined;
}

/** One in-flight optimistic update, from the caller's side. */
export interface OptimisticUpdateHandle {
  /**
   * Report how the request ended.
   *
   * Resolves once the cache is consistent again, which for the last mutation in
   * a scope means *after* its invalidation has refetched. Return it from
   * `onSettled` so the mutation stays pending until the screen is telling the
   * truth.
   *
   * Calling it twice is a no-op; the second call has no patch left to settle.
   */
  settle(outcome: OptimisticOutcome): Promise<void>;
}

/**
 * A monotonic tick, used to order "this guess was accepted" against "the server
 * answered for that entry".
 *
 * A counter rather than `Date.now()` because the two events routinely happen in
 * the same millisecond — a mutation resolving and its invalidation's refetch
 * landing are one microtask apart — and the whole question here is which came
 * first.
 */
let clock = 0;
const tick = (): number => ++clock;

interface PatchRecord {
  readonly apply: (previous: unknown, queryKey: QueryKey) => unknown;
  /** When the server accepted this guess, or `null` while it is still in flight. */
  confirmedAt: number | null;
}

interface BaseEntry {
  readonly key: QueryKey;
  /** The last value the *server* put in this entry. */
  data: unknown;
  /**
   * When the server last spoke for this entry, or `0` if it never has.
   *
   * Two decisions read this. Both come from the same fact: `invalidateQueries`
   * refetches *active* queries and only marks the rest stale, which is
   * TanStack's default and the right one — nobody is looking at an inactive
   * query — so "the mutation succeeded" and "this entry now holds the result"
   * are separate events that may never both happen.
   *
   * 1. A confirmed guess stops being applied to an entry the server has
   *    answered for *since* it was confirmed. Keeping it would double the row:
   *    the refetched list already contains it, under the server's id, and the
   *    guess would append the draft alongside.
   * 2. An entry the server has *not* answered for keeps the guess and is left
   *    stale. Writing the pre-mutation value back there would make the next
   *    component to mount render a list without the new row for a frame, before
   *    its own refetch corrected it.
   */
  refreshedAt: number;
}

interface ScopeState {
  readonly client: QueryClient;
  readonly queryKey: QueryKey;
  readonly invalidateKeys: QueryKey[];
  readonly base: Map<string, BaseEntry>;
  readonly patches: PatchRecord[];
  unsubscribe: (() => void) | null;
  /** Guards the listener against the writes the listener itself causes. */
  rendering: boolean;
}

/**
 * Live scopes, per `QueryClient`.
 *
 * A `WeakMap` because the lifetime that matters is the client's: a test that
 * builds a `QueryClient` per case, or an app that rebuilds one on logout,
 * should not leave scope state behind. Scopes are deleted as soon as they go
 * quiet, so this is empty whenever nothing is in flight.
 */
const scopeRegistry = new WeakMap<QueryClient, Map<string, ScopeState>>();

function scopesOf(client: QueryClient): Map<string, ScopeState> {
  const existing = scopeRegistry.get(client);
  if (existing) return existing;
  const created = new Map<string, ScopeState>();
  scopeRegistry.set(client, created);
  return created;
}

/**
 * A cache write the *server* made, as opposed to one this module made.
 *
 * `setQueryData` tags its dispatch `manual: true` and a resolved fetch does not,
 * which is the whole discrimination. Without it the listener would react to its
 * own writes and re-derive forever.
 */
function readServerWrite(event: QueryCacheNotifyEvent): { key: QueryKey; data: unknown } | null {
  if (event.type !== "updated") return null;
  const { action } = event;
  if (action.type !== "success" || action.manual === true) return null;
  const query: { queryKey: QueryKey } = event.query;
  const data: unknown = action.data;
  return { key: query.queryKey, data };
}

function readRemoval(event: QueryCacheNotifyEvent): QueryKey | null {
  if (event.type !== "removed") return null;
  const query: { queryKey: QueryKey } = event.query;
  return query.queryKey;
}

/**
 * Adopt every matching entry that is not already tracked.
 *
 * Safe to call at any point, which is less obvious than it looks: an entry that
 * has already been patched is in `base` by definition, so an entry that is
 * *not* in `base` is holding untouched server data and can be adopted as-is.
 * Entries with no data yet are skipped rather than adopted as `undefined` — a
 * query that has never resolved has no server word to be the base of, and the
 * listener will pick it up when its first fetch lands.
 */
function captureBase(scope: ScopeState): void {
  for (const [key, data] of scope.client.getQueriesData({ queryKey: scope.queryKey })) {
    if (data === undefined) continue;
    const hash = hashKey(key);
    if (!scope.base.has(hash)) scope.base.set(hash, { key, data, refreshedAt: 0 });
  }
}

/**
 * Is this guess still worth applying to this entry?
 *
 * Yes while it is in flight — that is the whole point. No once the server has
 * answered *for this entry* after accepting it, because the answer contains the
 * change already. Per entry rather than per scope: the list on screen gets
 * refetched and the one nobody is watching does not, and they need different
 * treatment in the same instant.
 */
function appliesTo(patch: PatchRecord, entry: BaseEntry): boolean {
  return patch.confirmedAt === null || patch.confirmedAt > entry.refreshedAt;
}

/**
 * Write `patches.reduce(apply, base)` into tracked entries.
 *
 * `onlyRefreshed` is the final pass, once the patches have been dropped: it
 * writes back only the entries the server has actually answered for. See
 * `BaseEntry.refreshedAt`.
 */
function render(scope: ScopeState, onlyRefreshed = false): void {
  scope.rendering = true;
  try {
    for (const entry of scope.base.values()) {
      if (onlyRefreshed && entry.refreshedAt === 0) continue;
      const next = scope.patches.reduce<unknown>(
        (value, patch) => (appliesTo(patch, entry) ? patch.apply(value, entry.key) : value),
        entry.data,
      );
      scope.client.setQueryData(entry.key, next);
    }
  } finally {
    scope.rendering = false;
  }
}

function subscribe(scope: ScopeState): void {
  scope.unsubscribe = scope.client.getQueryCache().subscribe((event) => {
    if (scope.rendering) return;
    if (!matchQuery({ queryKey: scope.queryKey }, event.query)) return;

    const removed = readRemoval(event);
    if (removed !== null) {
      scope.base.delete(hashKey(removed));
      return;
    }

    const write = readServerWrite(event);
    if (write === null) return;

    // The server has spoken for this entry. It becomes the new base — for an
    // entry already tracked because the mutation's own invalidation refetched
    // it, and for one seen here first because it mounted mid-flight.
    const hash = hashKey(write.key);
    const entry = scope.base.get(hash);
    if (entry) {
      entry.data = write.data;
      entry.refreshedAt = tick();
    } else {
      scope.base.set(hash, { key: write.key, data: write.data, refreshedAt: tick() });
    }
    render(scope);
  });
}

function teardown(scope: ScopeState): void {
  scope.unsubscribe?.();
  scope.unsubscribe = null;
  scope.base.clear();
  scopesOf(scope.client).delete(hashKey(scope.queryKey));
}

function hasUnconfirmed(scope: ScopeState): boolean {
  return scope.patches.some((patch) => patch.confirmedAt === null);
}

/**
 * Bring the cache back to server truth once nothing is in flight.
 *
 * Runs the invalidation rules first and drops the confirmed patches second,
 * which is the order that makes the handover invisible: by the time the guesses
 * come off, `base` already holds the rows they were guessing at.
 *
 * A mutation that starts while the invalidation is in the air aborts the
 * reconcile rather than racing it. Its `cancelQueries` may have killed the very
 * refetch we are waiting on, so `base` cannot be trusted to be fresh; the
 * confirmed patches stay applied and the *next* quiet point reconciles them.
 */
async function reconcile(scope: ScopeState): Promise<void> {
  try {
    await Promise.all(
      scope.invalidateKeys.map((queryKey) => scope.client.invalidateQueries({ queryKey })),
    );
  } catch {
    // Swallowed on purpose. `invalidateQueries` rejects when a refetch it
    // triggered rejects, and that is the *query's* failure: it has an error
    // state, an error boundary and a retry of its own, all of which the list is
    // already wired to. Letting it out of here would reach `onSettled`, which
    // TanStack treats as the mutation failing — so a write the server accepted
    // would report itself reverted because a GET afterwards timed out. The
    // entry keeps its guess (see `BaseEntry.refreshedAt`) and the query's own
    // retry is what fixes the screen.
  } finally {
    if (!hasUnconfirmed(scope)) {
      scope.patches.length = 0;
      render(scope, true);
      teardown(scope);
    }
  }
}

/**
 * Apply an optimistic patch to every cache entry under `queryKey`.
 *
 * Call it from `onMutate`, after `cancelQueries`, and hand the returned handle
 * to `onSettled`. `useOptimisticMutation` does both; reach for this directly
 * only when the mutation is not a `useMutation` — an imperative retry, a
 * background sync replay, a router action.
 *
 * Usage:
 *   await queryClient.cancelQueries({ queryKey: ["tasks", "list"] });
 *   const handle = beginOptimisticUpdate<readonly Task[]>(
 *     queryClient,
 *     { queryKey: ["tasks", "list"], invalidateKeys: [["tasks"]] },
 *     (tasks, key) => applyTaskChange(tasks, filterOf(key), { type: "create", task: draft }),
 *   );
 *   try {
 *     await api.create(draft.title);
 *     await handle.settle("success");
 *   } catch (error) {
 *     await handle.settle("error");
 *     throw error;
 *   }
 */
export function beginOptimisticUpdate<TData>(
  client: QueryClient,
  options: OptimisticScopeOptions,
  patch: OptimisticPatch<TData>,
): OptimisticUpdateHandle {
  const scopes = scopesOf(client);
  const hash = hashKey(options.queryKey);

  let scope = scopes.get(hash);
  if (!scope) {
    scope = {
      client,
      queryKey: options.queryKey,
      invalidateKeys: [],
      base: new Map(),
      patches: [],
      unsubscribe: null,
      rendering: false,
    };
    scopes.set(hash, scope);
    subscribe(scope);
  }

  // Two mutations sharing a scope may name different extra keys to invalidate;
  // the scope invalidates the union of them, once, when it goes quiet.
  const declared = options.invalidateKeys ?? [options.queryKey];
  for (const key of declared) {
    if (!scope.invalidateKeys.some((existing) => hashKey(existing) === hashKey(key))) {
      scope.invalidateKeys.push(key);
    }
  }

  captureBase(scope);

  const record: PatchRecord = {
    // The cast is the one place the per-entry `TData` meets the scope's
    // heterogeneous store. It is sound by construction: a scope's entries all
    // answer the same prefix, so they all hold the same shape, and the caller
    // named that shape when it wrote the patch.
    apply: (previous, queryKey) => patch(previous as TData, queryKey),
    confirmedAt: null,
  };
  const activeScope = scope;
  activeScope.patches.push(record);
  render(activeScope);

  let settled = false;

  return {
    async settle(outcome) {
      if (settled) return;
      settled = true;

      if (outcome === "error") {
        const index = activeScope.patches.indexOf(record);
        if (index !== -1) activeScope.patches.splice(index, 1);
        render(activeScope);
      } else {
        record.confirmedAt = tick();
      }

      // Somebody else is still guessing. Whoever settles last reconciles for
      // everyone — invalidating now would refetch into a cache that still owes
      // an answer, and cost a request per mutation instead of one per burst.
      if (hasUnconfirmed(activeScope)) return;

      await reconcile(activeScope);
    },
  };
}
