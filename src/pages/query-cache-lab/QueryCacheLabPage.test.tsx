import { describe, it, expect } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QueryCacheLabPage } from "@/pages/query-cache-lab/QueryCacheLabPage";

function renderLab(search = "?latency=0") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(
    [{ path: "/labs/query-cache", element: <QueryCacheLabPage /> }],
    {
      initialEntries: [`/labs/query-cache${search}`],
    },
  );

  return {
    router,
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
}

const titlesIn = (filter: "all" | "open" | "done"): string[] =>
  within(screen.getByTestId(`task-panel-${filter}`))
    .queryAllByTestId("cached-task-row")
    .map((row) => within(row).getByRole("checkbox").getAttribute("aria-label") ?? "");

async function seeded(): Promise<void> {
  await waitFor(() => {
    expect(titlesIn("all")).toHaveLength(3);
  });
}

describe("QueryCacheLabPage", () => {
  it("renders three filtered views of one set of rows", async () => {
    renderLab();
    await seeded();

    expect(screen.getByRole("heading", { name: "Query Cache Lab" })).toBeInTheDocument();
    expect(titlesIn("open")).toHaveLength(2);
    expect(titlesIn("done")).toHaveLength(1);
    expect(screen.getByTestId("task-stat-total")).toHaveTextContent("3");
  });

  it("defaults to a healthy server", () => {
    renderLab();

    expect(screen.getByTestId("fail-none")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("fail-create")).toHaveAttribute("aria-pressed", "false");
  });

  it("puts the rejecting verb in the URL", async () => {
    const { router, user } = renderLab();
    await seeded();

    await user.click(screen.getByTestId("fail-setDone"));

    await waitFor(() => {
      expect(router.state.location.search).toContain("fail=setDone");
    });
    expect(screen.getByTestId("fail-setDone")).toHaveAttribute("aria-pressed", "true");
  });

  it("reads the rejecting verb back out of the URL", async () => {
    renderLab("?fail=remove&latency=0");
    await seeded();

    expect(screen.getByTestId("fail-remove")).toHaveAttribute("aria-pressed", "true");
  });

  it("puts the latency in the URL", async () => {
    const { router, user } = renderLab();
    await seeded();

    await user.selectOptions(screen.getByTestId("cache-latency-select"), "600");

    await waitFor(() => {
      expect(router.state.location.search).toContain("latency=600");
    });
  });

  it("drops the cached rows when the fake server is replaced", async () => {
    const { user } = renderLab();
    await seeded();

    await user.type(screen.getByTestId("cached-task-input"), "Added to the old server");
    await waitFor(() => {
      expect(screen.getByTestId("cached-add-task")).toBeEnabled();
    });
    await user.click(screen.getByTestId("cached-add-task"));
    await waitFor(() => {
      expect(titlesIn("all")).toHaveLength(4);
    });

    // The knob rebuilds the fake server, so the cache is describing rows that
    // no longer exist anywhere. Remounting the board alone would leave it
    // reading them.
    await user.click(screen.getByTestId("fail-create"));

    await waitFor(() => {
      expect(titlesIn("all")).toHaveLength(3);
    });
  });

  it("rolls a rejected change back through the cache", async () => {
    const { user } = renderLab("?fail=create&latency=0");
    await seeded();

    await user.type(screen.getByTestId("cached-task-input"), "Doomed");
    await user.click(screen.getByTestId("cached-add-task"));

    expect(await screen.findByTestId("cached-task-error")).toHaveTextContent(
      "The server rejected this create call.",
    );
    expect(titlesIn("all")).toHaveLength(3);
  });
});
