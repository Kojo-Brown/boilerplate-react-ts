import { describe, it, expect, beforeEach } from "vitest";
import type { Task } from "@/entities/task/taskApi";
import {
  applyTaskChange,
  draftTask,
  isDraftTask,
  resetDraftIds,
  taskFilterFromKey,
  taskListKey,
  TASK_LIST_SCOPE,
  TASK_ROOT_KEY,
  TASK_STATS_KEY,
} from "@/entities/task/taskQueries";

const open: Task = { id: "1", title: "Open task", done: false };
const done: Task = { id: "2", title: "Done task", done: true };

describe("task query keys", () => {
  it("nests every key under the root, so one invalidation reaches them all", () => {
    for (const key of [TASK_LIST_SCOPE, TASK_STATS_KEY, taskListKey("open")]) {
      expect(key.slice(0, TASK_ROOT_KEY.length)).toEqual([...TASK_ROOT_KEY]);
    }
  });

  it("puts every list under the patched scope and the stats outside it", () => {
    expect(taskListKey("all").slice(0, TASK_LIST_SCOPE.length)).toEqual([...TASK_LIST_SCOPE]);
    // The counts are invalidated, never patched — a patch would have to know
    // the shape of what it is rewriting, and this entry holds an object.
    expect(TASK_STATS_KEY.slice(0, TASK_LIST_SCOPE.length)).not.toEqual([...TASK_LIST_SCOPE]);
  });

  it("reads the filter back out of a list key", () => {
    expect(taskFilterFromKey(taskListKey("done"))).toBe("done");
  });

  it("returns null for a key that is not one of its lists", () => {
    expect(taskFilterFromKey(TASK_STATS_KEY)).toBeNull();
    expect(taskFilterFromKey(["tasks", "list"])).toBeNull();
    expect(taskFilterFromKey(["tasks", "list", "archived"])).toBeNull();
  });
});

describe("applyTaskChange — create", () => {
  it("appends to a list whose filter admits the new row", () => {
    expect(applyTaskChange([open], "all", { type: "create", task: done })).toHaveLength(2);
    expect(applyTaskChange([], "open", { type: "create", task: open })).toEqual([open]);
  });

  it("leaves a list the row does not belong in untouched", () => {
    // A new task is never done, so the "done" list must not grow.
    expect(applyTaskChange([done], "done", { type: "create", task: open })).toEqual([done]);
  });

  it("is idempotent, because the patch is re-applied on every re-derive", () => {
    const once = applyTaskChange([], "all", { type: "create", task: open });
    const twice = applyTaskChange(once, "all", { type: "create", task: open });
    expect(twice).toEqual([open]);
  });
});

describe("applyTaskChange — setDone", () => {
  it("flips the row in a list that admits it either way", () => {
    const next = applyTaskChange([open], "all", { type: "setDone", task: open, done: true });
    expect(next).toEqual([{ ...open, done: true }]);
  });

  it("keeps the row in place rather than sending it to the bottom", () => {
    const third: Task = { id: "3", title: "Third", done: false };
    const next = applyTaskChange([open, done, third], "all", {
      type: "setDone",
      task: done,
      done: false,
    });
    expect(next.map((task) => task.id)).toEqual(["1", "2", "3"]);
  });

  it("removes the row from a list whose filter it no longer matches", () => {
    // The whole reason a patch is handed its entry's key: in the "open" list
    // this change is a deletion, not a flag flip.
    expect(applyTaskChange([open], "open", { type: "setDone", task: open, done: true })).toEqual(
      [],
    );
  });

  it("inserts the row into the list it has just moved into", () => {
    // The "done" list's cached rows have never contained this task, so a patch
    // that could only map over what is there would show nothing at all.
    expect(applyTaskChange([], "done", { type: "setDone", task: open, done: true })).toEqual([
      { ...open, done: true },
    ]);
  });
});

describe("applyTaskChange — remove", () => {
  it("drops the row from every list", () => {
    expect(applyTaskChange([open, done], "all", { type: "remove", id: "1" })).toEqual([done]);
  });

  it("is a no-op where the row was not cached", () => {
    expect(applyTaskChange([done], "done", { type: "remove", id: "1" })).toEqual([done]);
  });
});

describe("draft rows", () => {
  beforeEach(() => {
    resetDraftIds();
  });

  it("mints a distinct id per call so two creates cannot share a React key", () => {
    expect(draftTask("one").id).not.toBe(draftTask("two").id);
  });

  it("trims the title the way the server will", () => {
    expect(draftTask("  spaced  ").title).toBe("spaced");
  });

  it("recognises its own drafts and nothing else", () => {
    expect(isDraftTask(draftTask("a"))).toBe(true);
    expect(isDraftTask({ id: "server-task-1", title: "a", done: false })).toBe(false);
  });
});
