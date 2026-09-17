import { useOptimisticMutation } from "@/shared/api/useOptimisticMutation";
import type { QueryKey, UseMutationResult } from "@tanstack/react-query";
import type { OptimisticMutationContext } from "@/shared/api/useOptimisticMutation";
import type { Task, TaskQueryApi } from "@/entities/task/taskApi";
import {
  applyTaskChange,
  taskFilterFromKey,
  TASK_LIST_SCOPE,
  TASK_ROOT_KEY,
  type TaskChange,
} from "@/entities/task/taskQueries";

type TaskMutation<TVariables, TResult> = UseMutationResult<
  TResult,
  Error,
  TVariables,
  OptimisticMutationContext
>;

/**
 * What a create is called with: the title to send, and the row to draw.
 *
 * The draft is a *variable*, not something the patch invents, and that is the
 * one piece of this file worth reading twice. A patch runs once per cached
 * entry and again on every re-derive — every rollback, every refetch that lands
 * mid-flight — so minting the id inside it would give the same task a different
 * id in the `all` list and the `open` list, and a rollback keyed on the id
 * would then remove neither. Mint it once, before `mutate()`, and every
 * re-application draws the same row.
 */
export interface NewTask {
  readonly title: string;
  readonly draft: Task;
}

export interface SetTaskDone {
  readonly task: Task;
  readonly done: boolean;
}

export interface TaskMutations {
  readonly addTask: TaskMutation<NewTask, Task>;
  readonly setTaskDone: TaskMutation<SetTaskDone, Task>;
  // `unknown` rather than `void`: `delete` resolves with nothing, and a `void`
  // type argument on a call expression is what `no-invalid-void-type` forbids.
  readonly removeTask: TaskMutation<Task, unknown>;
}

/**
 * Turn a `TaskChange` into the patch every cached list gets.
 *
 * One function for all three mutations because the per-entry work is identical:
 * find out which filter this entry answers, then ask the entity how that change
 * reads under that filter. An entry whose key does not name a filter is left
 * alone rather than guessed at — that is a key this feature did not put in the
 * cache, and rewriting it would be a bug with no symptom until something read
 * it back.
 */
function patchLists(
  tasks: readonly Task[],
  queryKey: QueryKey,
  change: TaskChange,
): readonly Task[] {
  const filter = taskFilterFromKey(queryKey);
  return filter === null ? tasks : applyTaskChange(tasks, filter, change);
}

/**
 * The three task mutations, each writing its guess into the query cache.
 *
 * Every one of them names the same two keys, and the difference between them is
 * the whole idea:
 *
 * - `queryKey: TASK_LIST_SCOPE` is what gets **patched**. These entries hold
 *   rows, this client knows what the change does to a row, so it can draw the
 *   result immediately.
 * - `invalidateKeys: [TASK_ROOT_KEY]` is what gets **refetched** once the burst
 *   settles. It is the wider key on purpose: it covers the lists *and*
 *   `["tasks", "stats"]`, which is deliberately not patched. The counts are an
 *   aggregate over every row the server holds, while the lists on screen are a
 *   filtered view of some of them — a client that decremented `open` from what
 *   it can see would be extrapolating from a sample. What you can compute,
 *   patch; what only the server can answer, invalidate.
 *
 * `api` is a parameter rather than an import so the lab can hand in a server
 * that fails on demand, and so a test needs no MSW to exercise rollback.
 */
export function useTaskMutations(api: TaskQueryApi): TaskMutations {
  const addTask = useOptimisticMutation<readonly Task[], NewTask, Task>({
    queryKey: TASK_LIST_SCOPE,
    invalidateKeys: [TASK_ROOT_KEY],
    mutationFn: ({ title }) => api.create(title),
    patch: (tasks, { draft }, queryKey) =>
      patchLists(tasks, queryKey, { type: "create", task: draft }),
  });

  const setTaskDone = useOptimisticMutation<readonly Task[], SetTaskDone, Task>({
    queryKey: TASK_LIST_SCOPE,
    invalidateKeys: [TASK_ROOT_KEY],
    mutationFn: ({ task, done }) => api.setDone(task.id, done),
    patch: (tasks, { task, done }, queryKey) =>
      patchLists(tasks, queryKey, { type: "setDone", task, done }),
  });

  const removeTask = useOptimisticMutation<readonly Task[], Task>({
    queryKey: TASK_LIST_SCOPE,
    invalidateKeys: [TASK_ROOT_KEY],
    mutationFn: (task) => api.remove(task.id),
    patch: (tasks, task, queryKey) => patchLists(tasks, queryKey, { type: "remove", id: task.id }),
  });

  return { addTask, setTaskDone, removeTask };
}
