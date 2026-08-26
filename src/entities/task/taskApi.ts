import type { OptimisticListItem } from "@/shared/lib/optimisticList";

/**
 * The demo domain for the optimistic-mutation pattern.
 *
 * A task list is small enough to read in one screen and still exercises all
 * three mutation shapes: adding a row (`create`), flipping a field on one
 * (`update`), and removing one (`delete`).
 */
export interface Task extends OptimisticListItem {
  readonly title: string;
  readonly done: boolean;
}

/**
 * The mutation surface `<OptimisticTaskList>` depends on.
 *
 * Taking this as a prop rather than importing a module keeps the component
 * testable without MSW and lets the lab page swap in a server that fails on
 * demand — the failure path is the whole point of the pattern, so it has to be
 * as easy to reach as the success path.
 */
export interface TaskApi {
  create(title: string): Promise<Task>;
  setDone(id: string, done: boolean): Promise<Task>;
  remove(id: string): Promise<void>;
}

/** A single call against the fake server, as seen by `failWhen`. */
export type TaskApiCall =
  | { readonly type: "create"; readonly title: string }
  | { readonly type: "setDone"; readonly id: string; readonly done: boolean }
  | { readonly type: "remove"; readonly id: string };

/** Thrown by the in-memory API when `failWhen` asks for a failure. */
export class TaskApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskApiError";
  }
}

export interface InMemoryTaskApiOptions {
  readonly initialTasks?: readonly Task[] | undefined;
  /** Simulated round-trip time in ms. Defaults to 0 (settles on a microtask). */
  readonly latencyMs?: number | undefined;
  /**
   * Return a message to make that call fail, or `null` to let it through.
   * A predicate rather than a rate so tests and demos stay deterministic —
   * a flaky fake server would make a rollback test flaky too.
   */
  readonly failWhen?: ((call: TaskApiCall) => string | null) | undefined;
}

const delay = (ms: number): Promise<void> =>
  ms > 0
    ? new Promise((resolve) => {
        setTimeout(resolve, ms);
      })
    : Promise.resolve();

/**
 * An in-memory `TaskApi` with deterministic ids and controllable failures.
 *
 * Ids come from a counter rather than `crypto.randomUUID()` so a committed row
 * is assertable (`server-task-1`), which in turn makes "the optimistic id was
 * replaced by the server's id" a thing a test can actually check.
 *
 * Usage:
 *   const api = createInMemoryTaskApi({
 *     latencyMs: 400,
 *     failWhen: (call) => (call.type === "create" ? "Server rejected the task" : null),
 *   });
 */
export function createInMemoryTaskApi(options: InMemoryTaskApiOptions = {}): TaskApi {
  const { initialTasks = [], latencyMs = 0, failWhen } = options;

  const tasks = new Map<string, Task>(initialTasks.map((task) => [task.id, task]));
  let nextId = 1;

  async function settle(call: TaskApiCall): Promise<void> {
    await delay(latencyMs);
    const failure = failWhen?.(call);
    if (failure !== null && failure !== undefined) throw new TaskApiError(failure);
  }

  return {
    async create(title) {
      await settle({ type: "create", title });
      const task: Task = { id: `server-task-${nextId++}`, title: title.trim(), done: false };
      tasks.set(task.id, task);
      return task;
    },

    async setDone(id, done) {
      await settle({ type: "setDone", id, done });
      const existing = tasks.get(id);
      if (!existing) throw new TaskApiError(`No task with id ${id}`);
      const updated: Task = { ...existing, done };
      tasks.set(id, updated);
      return updated;
    },

    async remove(id) {
      await settle({ type: "remove", id });
      if (!tasks.delete(id)) throw new TaskApiError(`No task with id ${id}`);
    },
  };
}
