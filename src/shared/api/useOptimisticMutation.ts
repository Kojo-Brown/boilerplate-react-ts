import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import {
  beginOptimisticUpdate,
  type OptimisticScopeOptions,
  type OptimisticUpdateHandle,
} from "@/shared/api/optimisticCache";

/**
 * The four lifecycle steps of an optimistic mutation, wired once.
 *
 * Every one of them is the answer to a specific way the hand-rolled version
 * goes wrong, so they are worth naming even though the hook hides them:
 *
 * - **cancel** in `onMutate`, or a fetch that is already in the air resolves
 *   after the guess is drawn and overwrites it with data from before the
 *   mutation existed.
 * - **patch** every entry under the key, not just the one the component is
 *   reading, or two views of the same rows disagree.
 * - **settle** on both outcomes, or a failed mutation leaves its guess up
 *   forever. Rollback here removes one patch from a stack rather than restoring
 *   a snapshot, which is what keeps a concurrent mutation's row on screen; see
 *   `optimisticCache.ts`.
 * - **invalidate** once the scope is quiet, so the server gets the last word —
 *   including on the queries the mutation changed but this client cannot
 *   recompute.
 *
 * Returning the settle promise from `onSettled` is deliberate: TanStack awaits
 * it, so the mutation stays `pending` until the refetch has landed. A button
 * that re-enables on `isPending` therefore re-enables when the screen is true,
 * not when the socket closed.
 */
export interface OptimisticMutationOptions<
  TData,
  TVariables,
  TResult,
> extends OptimisticScopeOptions {
  /** The request. Nothing here touches the cache; that is what `patch` is for. */
  readonly mutationFn: (variables: TVariables) => Promise<TResult>;
  /**
   * The guess: what one cache entry becomes if the server agrees.
   *
   * Runs once per entry under `queryKey`, and is handed that entry's key so it
   * can tell them apart — the same change means different things to a list
   * filtered to open rows and one filtered to done rows.
   *
   * Must be pure and must not assume it runs once: it is re-applied whenever
   * the scope re-derives, which happens on every rollback and every refetch
   * that lands while it is in flight. A patch that appends a row built from
   * `Math.random()` would produce a different row each time it re-ran.
   */
  readonly patch: (previous: TData, variables: TVariables, queryKey: QueryKey) => TData;
  readonly onSuccess?: ((result: TResult, variables: TVariables) => void) | undefined;
  readonly onError?: ((error: Error, variables: TVariables) => void) | undefined;
}

/** What `onMutate` hands to `onSettled`. Exported because callers see it in the result type. */
export interface OptimisticMutationContext {
  readonly handle: OptimisticUpdateHandle;
}

/**
 * `useMutation` that writes its guess into the query cache and takes it back
 * off if the request fails.
 *
 * Usage:
 *   const addTask = useOptimisticMutation<readonly Task[], string, Task>({
 *     mutationFn: (title) => api.create(title),
 *     queryKey: TASK_LIST_SCOPE,
 *     invalidateKeys: [TASK_ROOT_KEY],
 *     patch: (tasks, _title, key) =>
 *       applyTaskChange(tasks, filterFromKey(key), { type: "create", task: draft }),
 *   });
 *
 *   addTask.mutate("Write the rollback test");
 *
 * `TData` is the shape of one cache entry under `queryKey` — the list, not the
 * row. `TVariables` is whatever `mutate()` is called with, and it reaches
 * `patch` unchanged so the guess can be built from the same input the request
 * was built from.
 */
export function useOptimisticMutation<TData, TVariables, TResult = unknown>(
  options: OptimisticMutationOptions<TData, TVariables, TResult>,
): UseMutationResult<TResult, Error, TVariables, OptimisticMutationContext> {
  const queryClient = useQueryClient();

  return useMutation<TResult, Error, TVariables, OptimisticMutationContext>({
    // The scope doubles as the mutation key, which is what makes
    // `useIsMutating({ mutationKey })` a reactive read of "is this list still
    // settling". It is the right question to put next to optimistic UI: the
    // rows are already on screen, so no single mutation's `isPending` describes
    // what the user is waiting for. Because `onSettled` below awaits the
    // invalidation, the count drops when the screen is true rather than when
    // the request returned.
    mutationKey: options.queryKey,
    mutationFn: (variables) => options.mutationFn(variables),

    onMutate: async (variables) => {
      // Before the guess, not after: `cancelQueries` reverts in-flight fetches
      // for this key, and a fetch cancelled *after* the write would still have
      // its response applied on the way out.
      await queryClient.cancelQueries({ queryKey: options.queryKey });

      const handle = beginOptimisticUpdate<TData>(
        queryClient,
        { queryKey: options.queryKey, invalidateKeys: options.invalidateKeys },
        (previous, queryKey) => options.patch(previous, variables, queryKey),
      );

      return { handle };
    },

    onSuccess: (result, variables) => {
      options.onSuccess?.(result, variables);
    },

    onError: (error, variables) => {
      options.onError?.(error, variables);
    },

    onSettled: async (_result, error, _variables, context) => {
      // `onMutate` can throw — `cancelQueries` rejects if a queryFn rejects
      // during cancellation — and then there is no context and no patch to
      // take back off.
      if (!context) return;
      await context.handle.settle(error ? "error" : "success");
    },
  });
}
