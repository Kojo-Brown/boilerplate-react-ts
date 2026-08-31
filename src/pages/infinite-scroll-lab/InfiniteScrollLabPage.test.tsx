import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { renderWithProviders } from "@/test/renderWithProviders";
import { installIntersectionObserver, type IntersectionHarness } from "@/test/intersection";
import { resetVirtualWindow } from "@/test/virtualizerMock";
import { createStubApiClient, type StubApiClient } from "@/shared/api/createStubApiClient";
import type { Post } from "@/entities/post/postsApi";
import type { FeedPage } from "@/entities/post/infiniteFeed";
import { InfiniteScrollLabPage } from "@/pages/infinite-scroll-lab/InfiniteScrollLabPage";
import {
  PREFETCH_MARGIN_PX,
  PREFETCH_MODES,
  parsePrefetchMode,
} from "@/pages/infinite-scroll-lab/infiniteScrollLabParams";

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

function renderLab(search = "", apiClient: StubApiClient = twoPageStub()) {
  const router = createMemoryRouter(
    [{ path: "/labs/infinite-scroll", element: <InfiniteScrollLabPage /> }],
    { initialEntries: [`/labs/infinite-scroll${search}`] },
  );
  renderWithProviders(<RouterProvider router={router} />, { apiClient });
  return { apiClient, router };
}

describe("parsePrefetchMode", () => {
  it("defaults to eager", () => {
    expect(parsePrefetchMode(null)).toBe("eager");
  });

  it("ignores anything it does not recognise", () => {
    expect(parsePrefetchMode("nonsense")).toBe("eager");
    expect(parsePrefetchMode("")).toBe("eager");
  });

  it("reads the modes it knows", () => {
    expect(parsePrefetchMode("eager")).toBe("eager");
    expect(parsePrefetchMode("end")).toBe("end");
  });

  it("has a margin for every mode", () => {
    for (const mode of PREFETCH_MODES) {
      expect(PREFETCH_MARGIN_PX[mode]).toBeTypeOf("number");
    }
  });

  it("makes the end arm a zero margin rather than a separate code path", () => {
    expect(PREFETCH_MARGIN_PX.end).toBe(0);
    expect(PREFETCH_MARGIN_PX.eager).toBeGreaterThan(0);
  });
});

describe("InfiniteScrollLabPage", () => {
  it("renders the heading", async () => {
    renderLab();
    expect(
      await screen.findByRole("heading", { name: "Windowed infinite scroll" }),
    ).toBeInTheDocument();
  });

  it("defaults to the eager arm", async () => {
    renderLab();
    await screen.findByText("Post 1");

    expect(screen.getByTestId("prefetch-mode-eager")).toHaveAttribute("aria-pressed", "true");
    expect(harness.observerFor(screen.getByTestId("prefetch-sentinel"))?.rootMargin).toBe(
      "0px 0px 600px 0px",
    );
  });

  it("reads the mode from the URL", async () => {
    renderLab("?prefetch=end");
    await screen.findByText("Post 1");

    expect(screen.getByTestId("prefetch-mode-end")).toHaveAttribute("aria-pressed", "true");
    expect(harness.observerFor(screen.getByTestId("prefetch-sentinel"))?.rootMargin).toBe(
      "0px 0px 0px 0px",
    );
  });

  it("moves the tripwire when the mode is switched", async () => {
    const user = userEvent.setup();
    renderLab();
    await screen.findByText("Post 1");

    await user.click(screen.getByTestId("prefetch-mode-end"));

    expect(harness.observerFor(screen.getByTestId("prefetch-sentinel"))?.rootMargin).toBe(
      "0px 0px 0px 0px",
    );
  });

  it("reports the feed's statistics from the same query the list renders", async () => {
    // One cache entry read twice: the page fetches nothing of its own.
    const client = twoPageStub();
    renderLab("", client);
    await screen.findByText("Post 1");

    expect(screen.getByTestId("stat-items")).toHaveTextContent("2");
    expect(screen.getByTestId("stat-total")).toHaveTextContent("4");
    expect(screen.getByTestId("stat-pages")).toHaveTextContent("1");
    expect(client.calls).toHaveLength(1);
  });

  it("counts a second page without issuing a second query", async () => {
    const client = twoPageStub();
    renderLab("", client);
    await screen.findByText("Post 1");

    harness.setIntersecting(screen.getByTestId("prefetch-sentinel"), true);
    await screen.findByText("Post 3");

    expect(screen.getByTestId("stat-items")).toHaveTextContent("4");
    expect(screen.getByTestId("stat-pages")).toHaveTextContent("2");
    expect(client.calls).toHaveLength(2);
  });

  it("reports the feed as complete once the last page has landed", async () => {
    renderLab();
    await screen.findByText("Post 1");
    expect(screen.getByTestId("stat-state")).toHaveTextContent("idle");

    harness.setIntersecting(screen.getByTestId("prefetch-sentinel"), true);
    await screen.findByText("Post 3");

    expect(screen.getByTestId("stat-state")).toHaveTextContent("complete");
  });
});
