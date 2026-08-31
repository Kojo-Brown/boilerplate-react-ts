import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiClientProvider } from "@/shared/api/ApiClientProvider";
import { createStubApiClient, type StubApiClient } from "@/shared/api/createStubApiClient";
import type { Post } from "@/entities/post/postsApi";
import type { FeedPage } from "@/entities/post/infiniteFeed";
import { useInfiniteFeed } from "@/entities/post/useInfiniteFeed";

const post = (id: number): Post => ({ id, title: `Post ${id}`, body: `Body ${id}`, userId: 1 });

const page = (ids: number[], nextCursor: string | null, total = 4): FeedPage => ({
  items: ids.map(post),
  nextCursor,
  total,
});

/** Two pages of two, the second being the last. */
function twoPageStub(): StubApiClient {
  return createStubApiClient({
    routes: {
      "GET /feed?limit=50": page([1, 2], "2"),
      "GET /feed?cursor=2&limit=50": page([3, 4], null),
    },
  });
}

function renderFeed(client: StubApiClient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    );
  }
  return renderHook(() => useInfiniteFeed(), { wrapper: Wrapper });
}

describe("useInfiniteFeed", () => {
  it("starts pending with nothing loaded", () => {
    const { result } = renderFeed(twoPageStub());
    expect(result.current.isPending).toBe(true);
    expect(result.current.items).toEqual([]);
    expect(result.current.pagesLoaded).toBe(0);
    expect(result.current.total).toBe(0);
  });

  it("loads the first page and reports another is available", async () => {
    const { result } = renderFeed(twoPageStub());

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    expect(result.current.items.map((i) => i.id)).toEqual([1, 2]);
    expect(result.current.total).toBe(4);
    expect(result.current.pagesLoaded).toBe(1);
    expect(result.current.hasNextPage).toBe(true);
  });

  it("appends the next page and stops at a null cursor", async () => {
    const client = twoPageStub();
    const { result } = renderFeed(client);
    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(true);
    });

    act(() => {
      result.current.fetchNextPage();
    });

    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(false);
    });
    expect(result.current.items.map((i) => i.id)).toEqual([1, 2, 3, 4]);
    expect(result.current.pagesLoaded).toBe(2);
    expect(client.calls.map((c) => c.path)).toEqual(["/feed?limit=50", "/feed?cursor=2&limit=50"]);
  });

  it("reports the total from the newest page, not the first", async () => {
    // A feed that grew while the user was scrolling should say so.
    const client = createStubApiClient({
      routes: {
        "GET /feed?limit=50": page([1, 2], "2", 4),
        "GET /feed?cursor=2&limit=50": page([3, 4], null, 9),
      },
    });
    const { result } = renderFeed(client);
    await waitFor(() => {
      expect(result.current.total).toBe(4);
    });

    act(() => {
      result.current.fetchNextPage();
    });

    await waitFor(() => {
      expect(result.current.total).toBe(9);
    });
  });

  it("de-duplicates a row re-served across the page boundary", async () => {
    const client = createStubApiClient({
      routes: {
        "GET /feed?limit=50": page([1, 2], "2"),
        "GET /feed?cursor=2&limit=50": page([2, 3], null),
      },
    });
    const { result } = renderFeed(client);
    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(true);
    });

    act(() => {
      result.current.fetchNextPage();
    });

    await waitFor(() => {
      expect(result.current.items).toHaveLength(3);
    });
    expect(result.current.items.map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it("surfaces a failure instead of an empty feed", async () => {
    const { result } = renderFeed(createStubApiClient());

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.items).toEqual([]);
  });

  it("asks for the page size it was given", async () => {
    const client = createStubApiClient({ routes: { "GET /feed?limit=2": page([1, 2], null) } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useInfiniteFeed({ pageSize: 2 }), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          <ApiClientProvider client={client}>{children}</ApiClientProvider>
        </QueryClientProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });
    expect(client.calls[0]?.path).toBe("/feed?limit=2");
  });

  it("keeps one identity for fetchNextPage across renders", async () => {
    const { result, rerender } = renderFeed(twoPageStub());
    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });
    const first = result.current.fetchNextPage;

    rerender();

    expect(result.current.fetchNextPage).toBe(first);
  });

  it("serves two callers from one cache entry and one request per page", async () => {
    // What lets the lab page render statistics beside the list without either
    // owning the query or a second request being made.
    const client = twoPageStub();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => ({ a: useInfiniteFeed(), b: useInfiniteFeed() }), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          <ApiClientProvider client={client}>{children}</ApiClientProvider>
        </QueryClientProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.a.items).toHaveLength(2);
    });

    expect(result.current.b.items).toEqual(result.current.a.items);
    expect(client.calls).toHaveLength(1);
  });
});
