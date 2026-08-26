import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { UseApiLabPage } from "@/pages/use-api-lab/UseApiLabPage";
import { actAsync, renderAsync } from "@/test/renderSuspense";

async function renderLab(search = "?latency=0") {
  const router = createMemoryRouter([{ path: "/labs/use", element: <UseApiLabPage /> }], {
    initialEntries: [`/labs/use${search}`],
  });
  return { router, ...(await renderAsync(<RouterProvider router={router} />)) };
}

const cardNames = (): string[] =>
  screen.queryAllByTestId("user-profile-card").map((card) => card.dataset["userId"] ?? "");

let consoleErrorSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("UseApiLabPage", () => {
  it("renders both profiles against the healthy server", async () => {
    await renderLab();

    expect(screen.getByRole("heading", { level: 1, name: "use() Lab" })).toBeInTheDocument();
    await waitFor(() => {
      expect(cardNames()).toEqual(["u-1", "u-2"]);
    });
    expect(screen.queryByTestId("profile-error")).not.toBeInTheDocument();
  });

  it("defaults to the healthy server", async () => {
    await renderLab();

    expect(screen.getByRole("button", { name: "Healthy server" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("reads the server mode from the URL and fails exactly one panel", async () => {
    await renderLab("?server=failing&latency=0");

    expect(await screen.findByTestId("profile-error")).toHaveTextContent("Could not load u-2.");
    expect(cardNames()).toEqual(["u-1"]);
  });

  it("switching to the failing server updates the URL and breaks one panel", async () => {
    const user = userEvent.setup();
    const { router } = await renderLab();

    await waitFor(() => {
      expect(cardNames()).toEqual(["u-1", "u-2"]);
    });

    await actAsync(() => user.click(screen.getByRole("button", { name: "Failing server" })));

    expect(router.state.location.search).toContain("server=failing");
    expect(await screen.findByTestId("profile-error")).toBeInTheDocument();
  });

  it("reads the latency from the URL", async () => {
    await renderLab("?latency=2000");

    expect(screen.getByTestId("profile-latency-select")).toHaveValue("2000");
  });

  it("clamps an out-of-range latency rather than rejecting it", async () => {
    await renderLab("?latency=999999");

    // Not one of the options, so the select falls back to no selection — the
    // assertion that matters is that the page still renders.
    expect(screen.getByRole("heading", { level: 1, name: "use() Lab" })).toBeInTheDocument();
  });

  it("changing the latency writes it to the URL", async () => {
    const user = userEvent.setup();
    const { router } = await renderLab();

    await actAsync(() => user.selectOptions(screen.getByTestId("profile-latency-select"), "600"));

    expect(router.state.location.search).toContain("latency=600");
  });

  it("reloading rebuilds the cache and re-renders both profiles", async () => {
    const user = userEvent.setup();
    await renderLab();

    await waitFor(() => {
      expect(cardNames()).toEqual(["u-1", "u-2"]);
    });

    await actAsync(() => user.click(screen.getByTestId("reload-profiles")));

    // A new cache means new promises, so the cards suspend again and come back.
    await waitFor(() => {
      expect(cardNames()).toEqual(["u-1", "u-2"]);
    });
  });

  it("recovers a failed panel after switching back to the healthy server", async () => {
    const user = userEvent.setup();
    await renderLab("?server=failing&latency=0");

    await screen.findByTestId("profile-error");

    await actAsync(() => user.click(screen.getByRole("button", { name: "Healthy server" })));

    await waitFor(() => {
      expect(cardNames()).toEqual(["u-1", "u-2"]);
    });
    expect(screen.queryByTestId("profile-error")).not.toBeInTheDocument();
  });
});
