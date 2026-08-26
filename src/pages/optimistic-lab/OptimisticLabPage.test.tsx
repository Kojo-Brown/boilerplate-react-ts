import { describe, it, expect } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { OptimisticLabPage } from "@/pages/optimistic-lab/OptimisticLabPage";

function renderLab(search = "?latency=0") {
  const router = createMemoryRouter(
    [{ path: "/labs/optimistic", element: <OptimisticLabPage /> }],
    {
      initialEntries: [`/labs/optimistic${search}`],
    },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

const rowTitles = (): string[] =>
  screen
    .queryAllByTestId("task-row")
    .map((row) => within(row).getByRole("checkbox").ariaLabel ?? "");

async function addTask(user: ReturnType<typeof userEvent.setup>, title: string): Promise<void> {
  await user.type(screen.getByTestId("task-input"), title);
  await user.click(screen.getByTestId("add-task"));
}

describe("OptimisticLabPage", () => {
  it("renders the lab heading and seeded tasks", () => {
    renderLab();

    expect(screen.getByRole("heading", { name: "Optimistic Lab" })).toBeInTheDocument();
    expect(rowTitles()).toEqual([
      "Read the rollback notes in the README",
      "Break the server and add a task",
    ]);
  });

  it("defaults to the healthy server", () => {
    renderLab();

    expect(screen.getByRole("button", { name: "Healthy server" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("reads the failing server from the URL", () => {
    renderLab("?server=failing&latency=0");

    expect(screen.getByRole("button", { name: "Failing server" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("treats an unknown server mode as healthy", () => {
    renderLab("?server=nonsense&latency=0");

    expect(screen.getByRole("button", { name: "Healthy server" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("keeps an added task against the healthy server", async () => {
    const user = userEvent.setup();
    renderLab();

    await addTask(user, "Gamma");

    await waitFor(() => {
      expect(rowTitles()).toContain("Gamma");
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("rolls the added task back against the failing server", async () => {
    const user = userEvent.setup();
    renderLab("?server=failing&latency=0");

    await addTask(user, "Gamma");

    expect(await screen.findByRole("alert")).toHaveTextContent("The server rejected this change.");
    expect(rowTitles()).not.toContain("Gamma");
  });

  it("writes the selected server mode back to the URL", async () => {
    const user = userEvent.setup();
    const { router } = renderLab();

    await user.click(screen.getByRole("button", { name: "Failing server" }));

    expect(router.state.location.search).toContain("server=failing");
    expect(screen.getByRole("button", { name: "Failing server" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("writes the selected latency back to the URL and preserves the server mode", async () => {
    const user = userEvent.setup();
    const { router } = renderLab("?server=failing&latency=0");

    await user.selectOptions(screen.getByTestId("latency-select"), "400");

    expect(router.state.location.search).toContain("latency=400");
    expect(router.state.location.search).toContain("server=failing");
  });

  it("reads the latency selection from the URL", () => {
    renderLab("?latency=1500");

    expect(screen.getByTestId("latency-select")).toHaveValue("1500");
  });

  it("resets the list back to the seed when the server is swapped", async () => {
    const user = userEvent.setup();
    renderLab();

    await addTask(user, "Gamma");
    await waitFor(() => {
      expect(rowTitles()).toContain("Gamma");
    });

    // The fake server is replaced, so the committed list has to be replaced too
    // — otherwise the list would claim rows the new server has never heard of.
    await user.click(screen.getByRole("button", { name: "Failing server" }));

    expect(rowTitles()).toEqual([
      "Read the rollback notes in the README",
      "Break the server and add a task",
    ]);
  });
});
