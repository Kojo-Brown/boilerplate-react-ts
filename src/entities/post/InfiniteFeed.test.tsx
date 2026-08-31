import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { installIntersectionObserver, type IntersectionHarness } from "@/test/intersection";
import { resetVirtualWindow } from "@/test/virtualizerMock";
import { createStubApiClient, type StubApiClient } from "@/shared/api/createStubApiClient";
import type { Post } from "@/entities/post/postsApi";
import type { FeedPage } from "@/entities/post/infiniteFeed";
import { InfiniteFeed } from "@/entities/post/InfiniteFeed";

vi.mock("@tanstack/react-virtual", () => import("@/test/virtualizerMock"));

let harness: IntersectionHarness;

beforeEach(() => {
  harness = installIntersectionObserver();
});

afterEach(() => {
  harness.restore();
  resetVirtualWindow();
});

const post = (id: number): Post => ({ id, title: `Post ${id}`, body: `Body ${id}`, userId: 1 });

const page = (ids: number[], nextCursor: string | null, total = 4): FeedPage => ({
  items: ids.map(post),
  nextCursor,
  total,
});

function twoPageStub(): StubApiClient {
  return createStubApiClient({
    routes: {
      "GET /feed?limit=50": page([1, 2], "2"),
      "GET /feed?cursor=2&limit=50": page([3, 4], null),
    },
  });
}

describe("InfiniteFeed", () => {
  it("shows a skeleton before the first page lands", () => {
    renderWithProviders(<InfiniteFeed />, { apiClient: twoPageStub() });
    expect(screen.getByTestId("infinite-feed-loading")).toBeInTheDocument();
  });

  it("renders the first page's rows", async () => {
    renderWithProviders(<InfiniteFeed />, { apiClient: twoPageStub() });

    expect(await screen.findByText("Post 1")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("names the list with the server's total", async () => {
    renderWithProviders(<InfiniteFeed />, { apiClient: twoPageStub() });

    expect(await screen.findByRole("list", { name: "Post feed, 4 items" })).toBeInTheDocument();
  });

  it("numbers rows by their position in the whole feed", async () => {
    renderWithProviders(<InfiniteFeed />, { apiClient: twoPageStub() });
    await screen.findByText("Post 1");

    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("1");
    expect(rows[1]).toHaveTextContent("2");
  });

  it("loads the next page when the sentinel comes into view", async () => {
    const client = twoPageStub();
    renderWithProviders(<InfiniteFeed />, { apiClient: client });
    await screen.findByText("Post 1");

    harness.setIntersecting(screen.getByTestId("prefetch-sentinel"), true);

    expect(await screen.findByText("Post 3")).toBeInTheDocument();
    expect(client.calls).toHaveLength(2);
  });

  it("removes the sentinel and announces the end once the feed is exhausted", async () => {
    renderWithProviders(<InfiniteFeed />, { apiClient: twoPageStub() });
    await screen.findByText("Post 1");

    harness.setIntersecting(screen.getByTestId("prefetch-sentinel"), true);
    await screen.findByText("Post 3");

    await waitFor(() => {
      expect(screen.queryByTestId("prefetch-sentinel")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent("All 4 items loaded");
  });

  it("makes exactly one request per page", async () => {
    const client = twoPageStub();
    renderWithProviders(<InfiniteFeed />, { apiClient: client });
    await screen.findByText("Post 1");

    harness.setIntersecting(screen.getByTestId("prefetch-sentinel"), true);
    await screen.findByText("Post 3");

    expect(client.calls.map((c) => c.path)).toEqual(["/feed?limit=50", "/feed?cursor=2&limit=50"]);
  });

  it("passes the prefetch margin down to the sentinel", async () => {
    renderWithProviders(<InfiniteFeed prefetchMargin={0} />, { apiClient: twoPageStub() });
    await screen.findByText("Post 1");

    const observer = harness.observerFor(screen.getByTestId("prefetch-sentinel"));
    expect(observer?.rootMargin).toBe("0px 0px 0px 0px");
  });

  it("reports a failure as an alert", async () => {
    // The default stub has no routes, so the request fails naming what it wanted.
    renderWithProviders(<InfiniteFeed />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the feed.");
  });
});
