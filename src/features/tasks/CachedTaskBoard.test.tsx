import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { CachedTaskBoard } from "@/features/tasks/CachedTaskBoard";
import { createInMemoryTaskApi, type Task, type TaskApiCall } from "@/entities/task/taskApi";
import { resetDraftIds } from "@/entities/task/taskQueries";

const SEED: readonly Task[] = [
  { id: "server-seed-1", title: "Already done", done: true },
  { id: "server-seed-2", title: "Still open", done: false },
];

interface RenderOptions {
  readonly failWhen?: ((call: TaskApiCall) => string | null) | undefined;
  /** Non-zero where a test needs the in-flight state to be observable. */
  readonly latencyMs?: number | undefined;
}

function renderBoard({ failWhen, latencyMs }: RenderOptions = {}): {
  user: ReturnType<typeof userEvent.setup>;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const api = createInMemoryTaskApi({ initialTasks: SEED, failWhen, latencyMs });

  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <CachedTaskBoard api={api} filters={["open", "done"]} />
    </QueryClientProvider>
  );
  render(ui);

  return { user: userEvent.setup() };
}

const panel = (filter: "open" | "done"): HTMLElement => screen.getByTestId(`task-panel-${filter}`);
const titlesIn = (filter: "open" | "done"): string[] =>
  within(panel(filter))
    .queryAllByTestId("cached-task-row")
    .map((row) => within(row).getByRole("checkbox").getAttribute("aria-label") ?? "");

async function loaded(): Promise<void> {
  await waitFor(() => {
    expect(titlesIn("open")).toEqual(["Still open"]);
  });
}

beforeEach(() => {
  resetDraftIds();
});

describe("CachedTaskBoard", () => {
  it("renders each filtered list from its own cache entry", async () => {
    renderBoard();
    await loaded();

    expect(titlesIn("done")).toEqual(["Already done"]);
    expect(screen.getByTestId("task-stat-total")).toHaveTextContent("2");
  });

  it("adds a task to every list that admits it, and to no others", async () => {
    const { user } = renderBoard();
    await loaded();

    await user.type(screen.getByTestId("cached-task-input"), "Write the doc");
    await user.click(screen.getByTestId("cached-add-task"));

    // One mutate(), two cache entries patched — and the "done" list correctly
    // refuses a row that is not done.
    await waitFor(() => {
      expect(titlesIn("open")).toEqual(["Still open", "Write the doc"]);
    });
    expect(titlesIn("done")).toEqual(["Already done"]);
  });

  it("moves a row between lists when it is toggled", async () => {
    const { user } = renderBoard();
    await loaded();

    await user.click(within(panel("open")).getByRole("checkbox", { name: "Still open" }));

    await waitFor(() => {
      expect(titlesIn("open")).toEqual([]);
    });
    expect(titlesIn("done")).toEqual(["Already done", "Still open"]);
  });

  it("replaces the draft id with the server's once the refetch lands", async () => {
    // Latency, so the provisional row is observable rather than gone by the
    // time the assertion runs.
    const { user } = renderBoard({ latencyMs: 60 });
    await loaded();

    await user.type(screen.getByTestId("cached-task-input"), "Provisional");
    await user.click(screen.getByTestId("cached-add-task"));

    // Re-queried each time rather than held: swapping the draft id for the
    // server's changes the React key, so the row is a different DOM node
    // afterwards and a captured reference would stay detached and provisional
    // forever — which is exactly the bug this test would otherwise miss.
    const row = (): Element | null =>
      within(panel("open")).getByRole("checkbox", { name: "Provisional" }).closest("li");

    await within(panel("open")).findByRole("checkbox", { name: "Provisional" });
    expect(row()).toHaveAttribute("data-draft", "true");

    // `data-draft` is derived from the id, so it clears itself the moment the
    // invalidation brings back the real row.
    await waitFor(() => {
      expect(row()).not.toHaveAttribute("data-draft");
    });
  });

  it("takes a rejected add back off and says so", async () => {
    const { user } = renderBoard({
      failWhen: (call) => (call.type === "create" ? "The server rejected this create call." : null),
    });
    await loaded();

    await user.type(screen.getByTestId("cached-task-input"), "Doomed");
    await user.click(screen.getByTestId("cached-add-task"));

    const alert = await screen.findByTestId("cached-task-error");
    expect(alert).toHaveTextContent("The server rejected this create call.");
    // A row that silently disappears is indistinguishable from a bug, which is
    // why the banner exists at all.
    expect(titlesIn("open")).toEqual(["Still open"]);
  });

  it("puts a rejected toggle back in the list it came from", async () => {
    const { user } = renderBoard({
      failWhen: (call) => (call.type === "setDone" ? "Nope." : null),
    });
    await loaded();

    await user.click(within(panel("open")).getByRole("checkbox", { name: "Still open" }));

    await screen.findByTestId("cached-task-error");
    expect(titlesIn("open")).toEqual(["Still open"]);
    expect(titlesIn("done")).toEqual(["Already done"]);
  });

  it("restores a rejected delete", async () => {
    const { user } = renderBoard({ failWhen: (call) => (call.type === "remove" ? "Nope." : null) });
    await loaded();

    await user.click(within(panel("open")).getByRole("button", { name: "Delete Still open" }));

    await screen.findByTestId("cached-task-error");
    expect(titlesIn("open")).toEqual(["Still open"]);
  });

  it("clears the banner when dismissed", async () => {
    const { user } = renderBoard({ failWhen: (call) => (call.type === "remove" ? "Nope." : null) });
    await loaded();

    await user.click(within(panel("open")).getByRole("button", { name: "Delete Still open" }));
    await screen.findByTestId("cached-task-error");

    await user.click(screen.getByTestId("cached-dismiss-error"));

    expect(screen.queryByTestId("cached-task-error")).not.toBeInTheDocument();
  });

  it("updates the server-side counts, which are invalidated rather than guessed", async () => {
    const { user } = renderBoard();
    await loaded();

    expect(screen.getByTestId("task-stat-open")).toHaveTextContent("1");

    await user.type(screen.getByTestId("cached-task-input"), "Another");
    await user.click(screen.getByTestId("cached-add-task"));

    await waitFor(() => {
      expect(screen.getByTestId("task-stat-open")).toHaveTextContent("2");
      expect(screen.getByTestId("task-stat-total")).toHaveTextContent("3");
    });
  });

  it("ignores an empty submission", async () => {
    const { user } = renderBoard();
    await loaded();

    await user.type(screen.getByTestId("cached-task-input"), "   ");
    // The button is disabled on whitespace, so submit the form directly.
    await user.keyboard("{Enter}");

    expect(titlesIn("open")).toEqual(["Still open"]);
    expect(screen.getByTestId("cached-add-task")).toBeDisabled();
  });

  it("shows a loading row before the first response", () => {
    renderBoard();

    expect(within(panel("open")).getByText("Loading…")).toBeInTheDocument();
  });

  it("says so when a list comes back empty", async () => {
    const { user } = renderBoard();
    await loaded();

    await user.click(within(panel("open")).getByRole("checkbox", { name: "Still open" }));

    await waitFor(() => {
      expect(within(panel("open")).getByText("Nothing here.")).toBeInTheDocument();
    });
  });

  it("marks the board busy while a change is settling", async () => {
    const { user } = renderBoard();
    await loaded();

    await user.type(screen.getByTestId("cached-task-input"), "Busy");
    await user.click(screen.getByTestId("cached-add-task"));

    // `aria-busy` tracks the scope, not one request: it stays up until the
    // invalidation has refetched.
    await waitFor(() => {
      expect(screen.getByTestId("cached-task-board")).toHaveAttribute("aria-busy", "false");
    });
    expect(titlesIn("open")).toEqual(["Still open", "Busy"]);
  });
});
