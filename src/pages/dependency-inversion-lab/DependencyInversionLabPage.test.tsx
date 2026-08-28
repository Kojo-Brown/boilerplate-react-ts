import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createStubApiClient } from "@/shared/api/createStubApiClient";
import { DependencyInversionLabPage } from "@/pages/dependency-inversion-lab/DependencyInversionLabPage";
import {
  STUB_POSTS,
  parseClientMode,
} from "@/pages/dependency-inversion-lab/dependencyInversionLabParams";

/** Stands in for the application's client, so "live" is distinguishable. */
const HOST_POSTS = [{ id: 1, title: "From the host client", body: "Live", userId: 1 }];

function renderLab(search = "") {
  const apiClient = createStubApiClient({ routes: { "GET /posts": HOST_POSTS } });
  const router = createMemoryRouter(
    [{ path: "/labs/dependency-inversion", element: <DependencyInversionLabPage /> }],
    { initialEntries: [`/labs/dependency-inversion${search}`] },
  );
  renderWithProviders(<RouterProvider router={router} />, { apiClient });
  // The stub is returned from here rather than read off the render result: the
  // harness widens it to `ApiClient`, and `calls` is the whole point of holding
  // on to it.
  return { apiClient, router };
}

describe("parseClientMode", () => {
  it("defaults to live and ignores anything it does not recognise", () => {
    expect(parseClientMode(null)).toBe("live");
    expect(parseClientMode("nonsense")).toBe("live");
    expect(parseClientMode("stub")).toBe("stub");
    expect(parseClientMode("live")).toBe("live");
  });
});

describe("DependencyInversionLabPage", () => {
  it("renders the feed from the host's client by default", async () => {
    const { apiClient } = renderLab();

    expect(await screen.findByText("From the host client")).toBeInTheDocument();
    expect(screen.getByTestId("client-mode-live")).toHaveAttribute("aria-pressed", "true");
    expect(apiClient.calls).toEqual([{ method: "GET", path: "/posts" }]);
  });

  it("reads the mode from the URL and serves the same feed from the lab's own stub", async () => {
    const { apiClient } = renderLab("?client=stub");

    expect(await screen.findByText(STUB_POSTS[0].title)).toBeInTheDocument();
    // The host's client was never asked: the inner provider owns this subtree.
    expect(apiClient.calls).toEqual([]);
  });

  it("swaps the implementation under an unchanged component when the mode changes", async () => {
    const user = userEvent.setup();
    const { apiClient } = renderLab();
    expect(await screen.findByText("From the host client")).toBeInTheDocument();

    await user.click(screen.getByTestId("client-mode-stub"));

    expect(await screen.findByText(STUB_POSTS[0].title)).toBeInTheDocument();
    expect(screen.queryByText("From the host client")).not.toBeInTheDocument();
    expect(apiClient.calls).toHaveLength(1);
  });

  it("logs the calls the stub actually received", async () => {
    renderLab("?client=stub");

    expect(await screen.findByText(STUB_POSTS[0].title)).toBeInTheDocument();
    expect(screen.getByTestId("stub-call-log")).toHaveTextContent("GET /posts");
  });
});
