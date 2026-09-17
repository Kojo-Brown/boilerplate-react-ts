import { matchesFilter, type Task, type TaskFilter } from "@/entities/task/taskApi";

/**
 * The task cache: what is keyed where, and which keys a write disturbs.
 *
 * Keys are built here rather than at the call sites so that the scope a
 * mutation patches (`TASK_LIST_SCOPE`) and the keys it invalidates
 * (`TASK_ROOT_KEY`) are provably prefixes of the entries they are meant to
 * reach. A key assembled inline drifts silently: nothing type-checks
 * `["task", "list", filter]` against `["tasks", "list", filter]`, and the
 * symptom is an invalidation that matches nothing.
 */

/** Everything about tasks. What a write invalidates. */
export const TASK_ROOT_KEY = ["tasks"] as const;

/**
 * Every cached list, across filters. What a write *patches*.
 *
 * Narrower than `TASK_ROOT_KEY` on purpose: a patch has to know the shape of
 * what it is rewriting, and `["tasks"]` also covers the stats entry, which is
 * an object rather than an array of rows.
 */
export const TASK_LIST_SCOPE = ["tasks", "list"] as const;

/** The server-side aggregate. Invalidated, never patched — see below. */
export const TASK_STATS_KEY = ["tasks", "stats"] as const;

export function taskListKey(filter: TaskFilter): readonly [string, string, TaskFilter] {
  return [...TASK_LIST_SCOPE, filter];
}

const TASK_FILTERS: readonly TaskFilter[] = ["all", "open", "done"];

/**
 * Read the filter back out of a cached list's key.
 *
 * The scope hands a patch the key of the entry it is rewriting, and this is how
 * that key becomes a filter again. It is written as a lookup rather than a cast
 * because the key is `readonly unknown[]` by the time it comes back from the
 * cache: `key[2] as TaskFilter` would type-check against a key that does not
 * belong to this entity at all, and produce a patch that filters by the string
 * `"undefined"`.
 */
export function taskFilterFromKey(key: readonly unknown[]): TaskFilter | null {
  const candidate = key[TASK_LIST_SCOPE.length];
  return TASK_FILTERS.find((filter) => filter === candidate) ?? null;
}

/**
 * A change to one task, in the vocabulary the cache patches are written in.
 *
 * `setDone` carries the whole task rather than just its id because the patch
 * may have to *insert* it: flipping a task to done removes it from the `open`
 * list and adds it to the `done` one, and the `done` list's cached rows do not
 * contain it yet. An id alone could only ever delete.
 */
export type TaskChange =
  | { readonly type: "create"; readonly task: Task }
  | { readonly type: "setDone"; readonly task: Task; readonly done: boolean }
  | { readonly type: "remove"; readonly id: string };

/**
 * Apply a change to one cached list, honouring that list's filter.
 *
 * This is the part of an optimistic update that is easy to get subtly wrong.
 * The obvious patch for "mark this done" is to map over the rows and flip the
 * flag, which is right for `["tasks", "list", "all"]` and wrong for the other
 * two: in the `open` list the row should leave, and in the `done` list a row
 * that was never there should appear. Writing the flip alone leaves a task
 * sitting in a list that is titled "open tasks" and is now lying, until
 * something refetches — which is exactly the interval an optimistic update
 * exists to fill.
 *
 * Pure, and safe to run more than once against the same base: the scope
 * re-derives the cache from the server's last word on every rollback and every
 * refetch that lands mid-flight, so a patch that appended unconditionally would
 * append twice.
 */
export function applyTaskChange(
  tasks: readonly Task[],
  filter: TaskFilter,
  change: TaskChange,
): readonly Task[] {
  switch (change.type) {
    case "create":
      if (!matchesFilter(change.task, filter)) return tasks;
      return tasks.some((task) => task.id === change.task.id)
        ? tasks
        : [...tasks, { ...change.task }];

    case "setDone": {
      const updated: Task = { ...change.task, done: change.done };
      const without = tasks.filter((task) => task.id !== updated.id);
      if (!matchesFilter(updated, filter)) return without;
      // Re-inserted where it was, so a toggle in the "all" list does not send
      // the row to the bottom and back.
      const index = tasks.findIndex((task) => task.id === updated.id);
      if (index === -1) return [...without, updated];
      return [...without.slice(0, index), updated, ...without.slice(index)];
    }

    case "remove":
      return tasks.filter((task) => task.id !== change.id);
  }
}

/**
 * The id an optimistic row carries until the server assigns a real one.
 *
 * Prefixed so a row that is still a guess is recognisable in the cache, in a
 * test and in the devtools, and counted so two creates in the same tick cannot
 * collide on a React key.
 */
let draftCounter = 0;

export function draftTask(title: string): Task {
  draftCounter += 1;
  return { id: `draft-task-${draftCounter}`, title: title.trim(), done: false };
}

/** Only for tests that assert on a specific draft id. */
export function resetDraftIds(): void {
  draftCounter = 0;
}

/** Is this row a guess the server has not confirmed yet? */
export function isDraftTask(task: Task): boolean {
  return task.id.startsWith("draft-task-");
}
