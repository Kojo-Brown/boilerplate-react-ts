import { describe, it, expect, vi } from "vitest";
import { createStubApiClient } from "@/shared/api/createStubApiClient";
import type { Post } from "@/entities/post/postsApi";
import {
  FEED_PAGE_SIZE,
  INFINITE_FEED_QUERY_KEY,
  feedPagePath,
  fetchFeedPage,
  flattenFeedPages,
  type FeedPage,
} from "@/entities/post/infiniteFeed";

const post = (id: number): Post => ({
  id,
  title: `Post ${id}`,
  body: `Body ${id}`,
  userId: 1,
});

const page = (ids: number[], nextCursor: string | null, total = 100): FeedPage => ({
  items: ids.map(post),
  nextCursor,
  total,
});

describe("feedPagePath", () => {
  it("omits the cursor on the first page", () => {
    expect(feedPagePath()).toBe("/feed?limit=50");
  });

  it("treats a null cursor as the first page", () => {
    expect(feedPagePath(null)).toBe("/feed?limit=50");
  });

  it("treats an empty cursor as the first page", () => {
    // A server that returned `""` instead of `null` would otherwise produce
    // `?cursor=&limit=50`, a different cache key for the same page.
    expect(feedPagePath("")).toBe("/feed?limit=50");
  });

  it("puts the cursor before the limit", () => {
    // The order is part of the contract with every stub that answers this
    // route: `createStubApiClient` matches the path string exactly.
    expect(feedPagePath("50")).toBe("/feed?cursor=50&limit=50");
  });

  it("carries a custom limit", () => {
    expect(feedPagePath("20", 20)).toBe("/feed?cursor=20&limit=20");
  });

  it("escapes an opaque cursor", () => {
    expect(feedPagePath("a b&c=d")).toBe("/feed?cursor=a+b%26c%3Dd&limit=50");
  });

  it("defaults the limit to the exported page size", () => {
    expect(feedPagePath(null)).toContain(`limit=${String(FEED_PAGE_SIZE)}`);
  });
});

describe("fetchFeedPage", () => {
  it("requests the first page with no cursor", async () => {
    const client = createStubApiClient({ routes: { "GET /feed?limit=50": page([1, 2], "2") } });

    const result = await fetchFeedPage(client);

    expect(result.nextCursor).toBe("2");
    expect(client.calls).toEqual([{ method: "GET", path: "/feed?limit=50" }]);
  });

  it("requests a later page with the cursor it was given", async () => {
    const client = createStubApiClient({
      routes: { "GET /feed?cursor=2&limit=50": page([3, 4], null) },
    });

    const result = await fetchFeedPage(client, { cursor: "2" });

    expect(result.items.map((i) => i.id)).toEqual([3, 4]);
  });

  it("honours a custom limit", async () => {
    const client = createStubApiClient({ routes: { "GET /feed?limit=2": page([1, 2], "2") } });

    await fetchFeedPage(client, { limit: 2 });

    expect(client.calls[0]?.path).toBe("/feed?limit=2");
  });

  it("forwards the caller's abort signal", async () => {
    const get = vi.fn().mockResolvedValue(page([1], null));
    const controller = new AbortController();
    const client = { get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };

    await fetchFeedPage(client, { signal: controller.signal });

    expect(get).toHaveBeenCalledWith("/feed?limit=50", { signal: controller.signal });
  });

  it("propagates a failure rather than returning an empty page", async () => {
    const client = createStubApiClient();

    await expect(fetchFeedPage(client)).rejects.toThrow(/No stub route/);
  });
});

describe("flattenFeedPages", () => {
  it("returns nothing for no pages", () => {
    expect(flattenFeedPages([])).toEqual([]);
  });

  it("concatenates pages in order", () => {
    const result = flattenFeedPages([page([1, 2], "2"), page([3, 4], null)]);
    expect(result.map((i) => i.id)).toEqual([1, 2, 3, 4]);
  });

  it("drops a row re-served across a page boundary", () => {
    // Not defensive: a cursor is a position in a feed that is still being
    // written to, so an insert between two requests re-serves the row that was
    // last on the previous page.
    const result = flattenFeedPages([page([1, 2, 3], "3"), page([3, 4], null)]);
    expect(result.map((i) => i.id)).toEqual([1, 2, 3, 4]);
  });

  it("keeps the first copy of a duplicate", () => {
    const first = { ...post(1), title: "Original" };
    const second = { ...post(1), title: "Edited" };
    const result = flattenFeedPages([
      { items: [first], nextCursor: "1", total: 2 },
      { items: [second], nextCursor: null, total: 2 },
    ]);
    expect(result).toEqual([first]);
  });

  it("deduplicates within a single page too", () => {
    expect(flattenFeedPages([page([1, 1, 2], null)]).map((i) => i.id)).toEqual([1, 2]);
  });

  it("produces keys that are unique across every page", () => {
    const items = flattenFeedPages([page([1, 2], "2"), page([2, 3], "3"), page([3, 4], null)]);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });
});

describe("INFINITE_FEED_QUERY_KEY", () => {
  it("does not collide with the single-shot feed's key", () => {
    expect(INFINITE_FEED_QUERY_KEY).toEqual(["infinite-feed"]);
  });
});
