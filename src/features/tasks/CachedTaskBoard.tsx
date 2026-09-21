import { useId, useState } from "react";
import { useIsMutating, useQuery } from "@tanstack/react-query";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { cn } from "@/shared/lib/cn";
import { useTaskMutations } from "@/features/tasks/useTaskMutations";
import type { Task, TaskFilter, TaskQueryApi, TaskStats } from "@/entities/task/taskApi";
import {
  draftTask,
  isDraftTask,
  taskListKey,
  TASK_LIST_SCOPE,
  TASK_STATS_KEY,
} from "@/entities/task/taskQueries";

export interface CachedTaskBoardProps {
  api: TaskQueryApi;
  /**
   * Which lists to render. Two by default, and two is the point: one mutation
   * has to leave both of them right, which is the thing a single-list demo
   * cannot show.
   */
  filters?: readonly TaskFilter[] | undefined;
  className?: string | undefined;
}

const DEFAULT_FILTERS: readonly TaskFilter[] = ["open", "done"];

const FILTER_LABELS: Record<TaskFilter, string> = {
  all: "All tasks",
  open: "Open",
  done: "Done",
};

/**
 * The same task list as `<OptimisticTaskList>`, kept in the query cache instead
 * of in component state.
 *
 * Side by side the two patterns answer different questions. `useOptimistic`
 * owns a list that one component renders, and its rollback is the absence of a
 * commit. This one owns rows that several components read through a shared
 * cache — two filtered lists and a counter here — and there is no component
 * state to fall back to, so the guess has to go into the cache and be taken
 * back out of it.
 *
 * What that buys, and what this component exists to show:
 *
 * - One `mutate()` updates **both** lists, because the patch runs against every
 *   entry under `["tasks", "list"]`. Marking a row done moves it from one panel
 *   to the other in the same frame.
 * - The counts do **not** move until the server says so, because they are
 *   invalidated rather than patched. The delay is the honest answer: the client
 *   cannot compute a total it has never seen.
 * - A failure takes the row back off and leaves any other in-flight change
 *   alone. With the latency knob up you can start a second change before the
 *   first fails and watch exactly that.
 *
 * Usage:
 *   <CachedTaskBoard api={createInMemoryTaskApi({ latencyMs: 400 })} />
 */
export function CachedTaskBoard({
  api,
  filters = DEFAULT_FILTERS,
  className,
}: CachedTaskBoardProps) {
  const inputId = useId();
  const [title, setTitle] = useState("");
  const { addTask, setTaskDone, removeTask } = useTaskMutations(api);

  const stats = useQuery({ queryKey: TASK_STATS_KEY, queryFn: () => api.stats() });

  // Not `addTask.isPending`: by the time a user is reading this the rows are
  // already on screen, and what is still open is the scope, not one request.
  // Every mutation in `useTaskMutations` is keyed by the scope it patches, so
  // this counts exactly the changes these lists are still waiting on.
  const isSettling = useIsMutating({ mutationKey: TASK_LIST_SCOPE }) > 0;

  const failure =
    addTask.error?.message ?? setTaskDone.error?.message ?? removeTask.error?.message ?? null;

  const submit = (): void => {
    const trimmed = title.trim();
    if (trimmed === "") return;
    setTitle("");
    // Minted here, once, and handed to the mutation as a variable — see the
    // note on `NewTask`. Inventing it inside the patch would give the same
    // task a different id in each cached list.
    const draft = draftTask(trimmed);
    addTask.mutate({ title: draft.title, draft });
  };

  const dismiss = (): void => {
    addTask.reset();
    setTaskDone.reset();
    removeTask.reset();
  };

  return (
    <section
      className={cn("flex flex-col gap-4", className)}
      data-testid="cached-task-board"
      aria-busy={isSettling}
    >
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={inputId} className="text-sm font-medium text-[var(--color-fg)]">
            New task
          </label>
          <Input
            id={inputId}
            value={title}
            placeholder="Something to do…"
            autoComplete="off"
            data-testid="cached-task-input"
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
        </div>
        <Button type="submit" disabled={title.trim() === ""} data-testid="cached-add-task">
          Add
        </Button>
      </form>

      {failure !== null && (
        <div
          role="alert"
          data-testid="cached-task-error"
          className={cn(
            "flex items-start justify-between gap-3 rounded-[var(--radius-md)] px-3 py-2",
            "border border-[var(--color-danger)] text-sm text-[var(--color-fg)]",
          )}
        >
          <span>
            <strong className="font-semibold">Change reverted.</strong> {failure}
          </span>
          <Button variant="ghost" size="sm" onClick={dismiss} data-testid="cached-dismiss-error">
            Dismiss
          </Button>
        </div>
      )}

      <StatsPanel stats={stats.data} isRefetching={stats.isFetching} />

      <div className="grid gap-4 sm:grid-cols-2">
        {filters.map((filter) => (
          <TaskPanel
            key={filter}
            filter={filter}
            api={api}
            onToggle={(task) => {
              setTaskDone.mutate({ task, done: !task.done });
            }}
            onRemove={(task) => {
              removeTask.mutate(task);
            }}
          />
        ))}
      </div>
    </section>
  );
}

interface StatsPanelProps {
  stats: TaskStats | undefined;
  isRefetching: boolean;
}

/**
 * The counts, and the lag in them.
 *
 * `aria-busy` while the invalidation refetches is not decoration: this panel is
 * the one part of the screen that is allowed to be behind, so it has to say so.
 */
function StatsPanel({ stats, isRefetching }: StatsPanelProps) {
  return (
    <dl
      data-testid="task-stats"
      aria-busy={isRefetching}
      aria-label="Task counts, from the server"
      className={cn(
        "flex gap-6 rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 py-3",
        "transition-colors duration-150",
        /*
          A background wash rather than the `opacity-60` this used to be.
          Dimming a panel dims its text with it, and these labels are already
          `--color-muted-fg` — the most muted thing the system has. At 60% they
          measure 2.51:1 in light mode and 2.85:1 in dark, so for as long as a
          refetch lasts the panel said "I am behind" by becoming unreadable to
          the people least able to spare the contrast. The wash changes the
          panel just as visibly and leaves every ratio where it was; `aria-busy`
          above already carries the same news to a screen reader.
        */
        isRefetching && "bg-[var(--color-muted)]",
      )}
    >
      {(["total", "open", "done"] as const).map((field) => (
        <div key={field} className="flex flex-col">
          <dt className="text-xs tracking-wide text-[var(--color-muted-fg)] uppercase">{field}</dt>
          <dd data-testid={`task-stat-${field}`} className="text-lg font-semibold">
            {stats ? stats[field] : "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

interface TaskPanelProps {
  filter: TaskFilter;
  api: TaskQueryApi;
  onToggle: (task: Task) => void;
  onRemove: (task: Task) => void;
}

/**
 * One panel, one cache entry, one `useQuery` of its own.
 *
 * Reading its own rows rather than being handed them by the board is the shape
 * the pattern is actually about: these panels are independent components that
 * happen to share a cache, and a mutation reaching all of them is a property of
 * the cache rather than of a parent passing props down. Lifting the reads into
 * the board would make the demo pass its own test for the wrong reason — a
 * single `data` array, re-rendered.
 */
function TaskPanel({ filter, api, onToggle, onRemove }: TaskPanelProps) {
  const { data: tasks, isPending } = useQuery({
    queryKey: taskListKey(filter),
    queryFn: () => api.list(filter),
  });

  return (
    <section
      data-testid={`task-panel-${filter}`}
      className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3"
    >
      <h3 className="text-sm font-semibold text-[var(--color-fg)]">{FILTER_LABELS[filter]}</h3>
      <ul role="list" aria-label={FILTER_LABELS[filter]} className="flex flex-col">
        {isPending ? (
          <li className="px-1 py-4 text-sm opacity-70">Loading…</li>
        ) : tasks && tasks.length > 0 ? (
          tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onToggle={() => {
                onToggle(task);
              }}
              onRemove={() => {
                onRemove(task);
              }}
            />
          ))
        ) : (
          <li className="px-1 py-4 text-sm opacity-70">Nothing here.</li>
        )}
      </ul>
    </section>
  );
}

interface TaskRowProps {
  task: Task;
  onToggle: () => void;
  onRemove: () => void;
}

function TaskRow({ task, onToggle, onRemove }: TaskRowProps) {
  // A row is a guess exactly while it still carries a draft id. Once the
  // invalidation lands it is wearing the server's id and stops being dimmed —
  // no extra flag to keep in sync with the cache.
  const isDraft = isDraftTask(task);

  return (
    <li
      data-testid="cached-task-row"
      data-draft={isDraft ? "true" : undefined}
      aria-busy={isDraft}
      className={cn(
        "flex items-center gap-3 border-b border-[var(--color-border)] px-1 py-2 last:border-b-0",
        "transition-opacity duration-150",
        isDraft && "opacity-60",
      )}
    >
      <input
        type="checkbox"
        checked={task.done}
        onChange={onToggle}
        aria-label={task.title}
        className="size-4 accent-[var(--color-primary)]"
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm text-[var(--color-fg)]",
          task.done && "line-through opacity-60",
        )}
      >
        {task.title}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRemove}
        aria-label={`Delete ${task.title}`}
        data-testid="cached-delete-task"
      >
        Delete
      </Button>
    </li>
  );
}
