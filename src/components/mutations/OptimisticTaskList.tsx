import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { useOptimisticList } from "@/hooks/useOptimisticList";
import type { Task, TaskApi } from "@/lib/taskApi";

export interface OptimisticTaskListProps {
  /** Seeds the committed list. Read once — see `useOptimisticList`. */
  initialTasks: readonly Task[];
  api: TaskApi;
  className?: string | undefined;
}

/**
 * A task list where every mutation lands on screen before the request does,
 * and takes itself back off if the request fails.
 *
 * The three handlers below are the whole pattern. Each one names the change
 * twice — once as a guess (`optimistic`) and once as a fact (`commit`) — and
 * does nothing at all about failure, because not committing is what rolls the
 * guess back. The only failure handling in this file is *displaying* the error
 * the hook captured, which is exactly the part `useOptimistic` cannot do for
 * you: a row that silently disappears is indistinguishable from a bug.
 *
 * Optimistic rows are dimmed and marked `aria-busy` rather than being replaced
 * by a spinner. The point of the pattern is that the list stays usable while
 * the request is in flight; covering it with a loading state would give the
 * whole thing back.
 *
 * Usage:
 *   <OptimisticTaskList initialTasks={tasks} api={createInMemoryTaskApi()} />
 */
export function OptimisticTaskList({ initialTasks, api, className }: OptimisticTaskListProps) {
  const inputId = useId();
  const [title, setTitle] = useState("");
  const { items, isPending, error, clearError, mutate } = useOptimisticList<Task>(initialTasks);

  // Optimistic creates need an id before the server has assigned one. It is a
  // placeholder for one render pass — the committed row arrives with the real
  // id and the optimistic copy is discarded — but it still has to be unique,
  // or React reuses the wrong row when two creates overlap.
  const draftIdRef = useRef(0);

  const addTask = (): void => {
    const trimmed = title.trim();
    if (trimmed === "") return;
    setTitle("");

    const draft: Task = { id: `draft-${++draftIdRef.current}`, title: trimmed, done: false };
    mutate({
      optimistic: { type: "create", item: draft },
      commit: async () => ({ type: "create", item: await api.create(trimmed) }),
    });
  };

  const toggleTask = (task: Task): void => {
    const done = !task.done;
    mutate({
      optimistic: { type: "update", id: task.id, patch: { done } },
      commit: async () => {
        const saved = await api.setDone(task.id, done);
        return { type: "update", id: task.id, patch: { done: saved.done, title: saved.title } };
      },
    });
  };

  const removeTask = (task: Task): void => {
    mutate({
      optimistic: { type: "delete", id: task.id },
      commit: async () => {
        await api.remove(task.id);
        return { type: "delete", id: task.id };
      },
    });
  };

  return (
    <section
      className={cn("flex flex-col gap-4", className)}
      data-testid="optimistic-task-list"
      aria-busy={isPending}
    >
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          addTask();
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
            data-testid="task-input"
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
        </div>
        <Button type="submit" disabled={title.trim() === ""} data-testid="add-task">
          Add
        </Button>
      </form>

      {error && (
        <div
          role="alert"
          data-testid="task-error"
          className={cn(
            "flex items-start justify-between gap-3 rounded-[var(--radius-md)] px-3 py-2",
            "border border-[var(--color-danger)] text-sm text-[var(--color-fg)]",
          )}
        >
          <span>
            <strong className="font-semibold">Change reverted.</strong> {error.message}
          </span>
          <Button variant="ghost" size="sm" onClick={clearError} data-testid="dismiss-task-error">
            Dismiss
          </Button>
        </div>
      )}

      <ul role="list" aria-label="Tasks" data-testid="task-rows" className="flex flex-col">
        {items.length === 0 ? (
          <li className="px-1 py-4 text-sm text-[var(--color-fg)] opacity-70">
            No tasks yet. Add one above.
          </li>
        ) : (
          items.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onToggle={() => {
                toggleTask(task);
              }}
              onRemove={() => {
                removeTask(task);
              }}
            />
          ))
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
  const isPending = task.pending !== undefined;

  return (
    <li
      data-testid="task-row"
      data-pending={task.pending ?? ""}
      aria-busy={isPending}
      className={cn(
        "flex items-center gap-3 border-b border-[var(--color-border)] px-1 py-2 last:border-b-0",
        "transition-opacity duration-150",
        isPending && "opacity-60",
      )}
    >
      <input
        type="checkbox"
        checked={task.done}
        onChange={onToggle}
        // The accessible name has to be the title, not "done" — a screen reader
        // user hearing three checkboxes called "Done" learns nothing.
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
        data-testid="delete-task"
      >
        Delete
      </Button>
    </li>
  );
}
