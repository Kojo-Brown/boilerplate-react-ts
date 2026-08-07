import { describe, it, expect } from "vitest";
import { createInMemoryTaskApi, TaskApiError, type Task, type TaskApiCall } from "@/lib/taskApi";

const seed: readonly Task[] = [{ id: "server-seed-1", title: "Seeded", done: false }];

describe("createInMemoryTaskApi", () => {
  it("assigns deterministic, incrementing ids", async () => {
    const api = createInMemoryTaskApi();

    expect((await api.create("One")).id).toBe("server-task-1");
    expect((await api.create("Two")).id).toBe("server-task-2");
  });

  it("returns a created task with the trimmed title and done=false", async () => {
    const api = createInMemoryTaskApi();

    expect(await api.create("  Padded  ")).toEqual({
      id: "server-task-1",
      title: "Padded",
      done: false,
    });
  });

  it("toggles done on a seeded task", async () => {
    const api = createInMemoryTaskApi({ initialTasks: seed });

    expect(await api.setDone("server-seed-1", true)).toEqual({
      id: "server-seed-1",
      title: "Seeded",
      done: true,
    });
  });

  it("persists an update across calls", async () => {
    const api = createInMemoryTaskApi({ initialTasks: seed });

    await api.setDone("server-seed-1", true);

    expect(await api.setDone("server-seed-1", false)).toMatchObject({ done: false });
  });

  it("removes a task, and rejects a second removal of the same id", async () => {
    const api = createInMemoryTaskApi({ initialTasks: seed });

    await expect(api.remove("server-seed-1")).resolves.toBeUndefined();
    await expect(api.remove("server-seed-1")).rejects.toThrow(TaskApiError);
  });

  it("rejects updates and removals of unknown ids", async () => {
    const api = createInMemoryTaskApi();

    await expect(api.setDone("nope", true)).rejects.toThrow(/No task with id nope/);
    await expect(api.remove("nope")).rejects.toThrow(/No task with id nope/);
  });

  it("fails the calls that failWhen selects and lets the others through", async () => {
    const api = createInMemoryTaskApi({
      initialTasks: seed,
      failWhen: (call) => (call.type === "create" ? "Creation is down" : null),
    });

    await expect(api.create("Nope")).rejects.toThrow("Creation is down");
    await expect(api.setDone("server-seed-1", true)).resolves.toMatchObject({ done: true });
  });

  it("describes each call to failWhen", async () => {
    const calls: TaskApiCall[] = [];
    const api = createInMemoryTaskApi({
      initialTasks: seed,
      failWhen: (call) => {
        calls.push(call);
        return null;
      },
    });

    await api.create("Added");
    await api.setDone("server-seed-1", true);
    await api.remove("server-seed-1");

    expect(calls).toEqual([
      { type: "create", title: "Added" },
      { type: "setDone", id: "server-seed-1", done: true },
      { type: "remove", id: "server-seed-1" },
    ]);
  });

  it("does not apply a change that failWhen rejected", async () => {
    const api = createInMemoryTaskApi({
      initialTasks: seed,
      failWhen: () => "Everything is down",
    });

    await expect(api.create("Ghost")).rejects.toThrow(TaskApiError);

    // The failure happens before the write, so a later healthy call still sees
    // only the seeded task — the fake server does not half-apply.
    const healthy = createInMemoryTaskApi({ initialTasks: seed });
    await expect(healthy.setDone("server-seed-1", true)).resolves.toBeDefined();
  });

  it("waits out the configured latency", async () => {
    const api = createInMemoryTaskApi({ latencyMs: 40 });
    const start = performance.now();

    await api.create("Slow");

    expect(performance.now() - start).toBeGreaterThanOrEqual(30);
  });
});
