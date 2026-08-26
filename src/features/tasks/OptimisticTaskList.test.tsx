import { describe, it, expect } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OptimisticTaskList } from "@/features/tasks/OptimisticTaskList";
import {
  createInMemoryTaskApi,
  type Task,
  type TaskApi,
  type TaskApiCall,
} from "@/entities/task/taskApi";

const seed: readonly Task[] = [
  { id: "server-seed-1", title: "Alpha", done: false },
  { id: "server-seed-2", title: "Beta", done: true },
];

const healthy = (): TaskApi => createInMemoryTaskApi({ initialTasks: seed });

const failing = (message = "The server rejected this change."): TaskApi =>
  createInMemoryTaskApi({ initialTasks: seed, failWhen: () => message });

const failingOnly = (type: TaskApiCall["type"], message: string): TaskApi =>
  createInMemoryTaskApi({
    initialTasks: seed,
    failWhen: (call) => (call.type === type ? message : null),
  });

const rowTitles = (): string[] =>
  screen
    .queryAllByTestId("task-row")
    .map((row) => within(row).getByRole("checkbox").ariaLabel ?? "");

async function addTask(user: ReturnType<typeof userEvent.setup>, title: string): Promise<void> {
  await user.type(screen.getByTestId("task-input"), title);
  await user.click(screen.getByTestId("add-task"));
}

describe("OptimisticTaskList", () => {
  it("renders the seeded tasks", () => {
    render(<OptimisticTaskList initialTasks={seed} api={healthy()} />);

    expect(rowTitles()).toEqual(["Alpha", "Beta"]);
    expect(screen.getByRole("checkbox", { name: "Beta" })).toBeChecked();
  });

  it("shows an empty state with no tasks", () => {
    render(<OptimisticTaskList initialTasks={[]} api={healthy()} />);

    expect(screen.getByText("No tasks yet. Add one above.")).toBeInTheDocument();
    expect(screen.queryAllByTestId("task-row")).toHaveLength(0);
  });

  it("disables Add until the input has a non-blank title", async () => {
    const user = userEvent.setup();
    render(<OptimisticTaskList initialTasks={seed} api={healthy()} />);

    expect(screen.getByTestId("add-task")).toBeDisabled();

    await user.type(screen.getByTestId("task-input"), "   ");
    expect(screen.getByTestId("add-task")).toBeDisabled();

    await user.type(screen.getByTestId("task-input"), "Gamma");
    expect(screen.getByTestId("add-task")).toBeEnabled();
  });

  it("keeps an added task and clears the input when the server accepts it", async () => {
    const user = userEvent.setup();
    render(<OptimisticTaskList initialTasks={seed} api={healthy()} />);

    await addTask(user, "Gamma");

    await waitFor(() => {
      expect(screen.getByTestId("optimistic-task-list")).toHaveAttribute("aria-busy", "false");
    });
    expect(rowTitles()).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(screen.getByTestId("task-input")).toHaveValue("");
    expect(screen.queryByTestId("task-error")).not.toBeInTheDocument();
  });

  it("marks a not-yet-committed row as pending while the request is in flight", async () => {
    const user = userEvent.setup();
    render(
      <OptimisticTaskList
        initialTasks={seed}
        api={createInMemoryTaskApi({ initialTasks: seed, latencyMs: 60 })}
      />,
    );

    await addTask(user, "Gamma");

    const pendingRow = screen.getAllByTestId("task-row")[2];
    expect(pendingRow).toHaveAttribute("data-pending", "create");
    expect(pendingRow).toHaveAttribute("aria-busy", "true");

    await waitFor(() => {
      expect(screen.getAllByTestId("task-row")[2]).toHaveAttribute("data-pending", "");
    });
  });

  it("rolls an added task back and explains why when the server rejects it", async () => {
    const user = userEvent.setup();
    render(<OptimisticTaskList initialTasks={seed} api={failing("Quota exceeded")} />);

    await addTask(user, "Gamma");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Change reverted.");
    expect(alert).toHaveTextContent("Quota exceeded");
    expect(rowTitles()).toEqual(["Alpha", "Beta"]);
  });

  it("toggles a task and keeps the new value when the server accepts it", async () => {
    const user = userEvent.setup();
    render(<OptimisticTaskList initialTasks={seed} api={healthy()} />);

    await user.click(screen.getByRole("checkbox", { name: "Alpha" }));

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeChecked();
    });
    expect(screen.queryByTestId("task-error")).not.toBeInTheDocument();
  });

  it("rolls a toggle back to its committed value when the server rejects it", async () => {
    const user = userEvent.setup();
    render(
      <OptimisticTaskList initialTasks={seed} api={failingOnly("setDone", "Toggle failed")} />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Alpha" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Toggle failed");
    expect(screen.getByRole("checkbox", { name: "Alpha" })).not.toBeChecked();
  });

  it("removes a task when the server accepts the delete", async () => {
    const user = userEvent.setup();
    render(<OptimisticTaskList initialTasks={seed} api={healthy()} />);

    await user.click(screen.getByRole("button", { name: "Delete Alpha" }));

    await waitFor(() => {
      expect(rowTitles()).toEqual(["Beta"]);
    });
    expect(screen.queryByTestId("task-error")).not.toBeInTheDocument();
  });

  it("puts a deleted task back when the server rejects the delete", async () => {
    const user = userEvent.setup();
    render(<OptimisticTaskList initialTasks={seed} api={failingOnly("remove", "Delete failed")} />);

    await user.click(screen.getByRole("button", { name: "Delete Alpha" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Delete failed");
    expect(rowTitles()).toEqual(["Alpha", "Beta"]);
  });

  it("dismisses the error banner on request", async () => {
    const user = userEvent.setup();
    render(<OptimisticTaskList initialTasks={seed} api={failing()} />);

    await addTask(user, "Gamma");
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByTestId("dismiss-task-error"));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears a stale error as soon as the next mutation starts", async () => {
    const user = userEvent.setup();
    // Creates fail, toggles succeed — so the second mutation must clear the
    // banner the first one raised without needing its own failure to do it.
    render(<OptimisticTaskList initialTasks={seed} api={failingOnly("create", "Create failed")} />);

    await addTask(user, "Gamma");
    expect(await screen.findByRole("alert")).toHaveTextContent("Create failed");

    await user.click(screen.getByRole("checkbox", { name: "Alpha" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("trims the title it sends and never submits a blank one", async () => {
    const user = userEvent.setup();
    const calls: TaskApiCall[] = [];
    const api = createInMemoryTaskApi({
      initialTasks: seed,
      failWhen: (call) => {
        calls.push(call);
        return null;
      },
    });
    render(<OptimisticTaskList initialTasks={seed} api={api} />);

    await user.type(screen.getByTestId("task-input"), "  Gamma  {Enter}");

    await waitFor(() => {
      expect(calls).toEqual([{ type: "create", title: "Gamma" }]);
    });
  });

  it("submits on Enter as well as on the Add button", async () => {
    const user = userEvent.setup();
    render(<OptimisticTaskList initialTasks={seed} api={healthy()} />);

    await user.type(screen.getByTestId("task-input"), "Gamma{Enter}");

    await waitFor(() => {
      expect(rowTitles()).toEqual(["Alpha", "Beta", "Gamma"]);
    });
  });
});
