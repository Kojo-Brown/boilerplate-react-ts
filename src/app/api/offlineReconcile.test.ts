import { describe, it, expect, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { baseApi } from "@/shared/api/baseApi";
import { INFINITE_FEED_QUERY_KEY } from "@/entities/post/infiniteFeed";
import { POST_FEED_QUERY_KEY } from "@/entities/post/postFeed";
import { createStubOfflineClient } from "@/test/offlineState";
import {
  invalidationFor,
  mergeInvalidations,
  reconcileReplay,
  startOfflineReconciliation,
  type ReconcileDeps,
} from "@/app/api/offlineReconcile";

function deps(): ReconcileDeps & {
  readonly invalidated: () => { queryKey?: unknown }[];
  readonly dispatched: ReturnType<typeof vi.fn>;
} {
  const calls: { queryKey?: unknown }[] = [];
  const queryClient = new QueryClient();
  // Spied rather than observed through the cache: what is under test is which
  // keys this module asks for, and a `QueryClient` with no mounted observers
  // refetches nothing, so the cache would report the same thing either way.
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation((filters) => {
    calls.push(filters ?? {});
    return Promise.resolve();
  });
  const dispatched = vi.fn();
  return { queryClient, dispatch: dispatched, invalidated: () => calls, dispatched };
}

describe("invalidationFor", () => {
  it("maps a write against the post collection to both feeds and the list tag", () => {
    expect(invalidationFor({ url: "https://app.test/api/posts" })).toEqual({
      queryKeys: [POST_FEED_QUERY_KEY, INFINITE_FEED_QUERY_KEY],
      tags: [{ type: "Post", id: "LIST" }],
    });
  });

  it("names the row as well as the list for a write against one post", () => {
    // A delete removes the row from both: the entry keyed by its id, and every
    // list that was holding it.
    expect(invalidationFor({ url: "https://app.test/api/posts/7" })).toEqual({
      queryKeys: [POST_FEED_QUERY_KEY, INFINITE_FEED_QUERY_KEY],
      tags: [
        { type: "Post", id: "7" },
        { type: "Post", id: "LIST" },
      ],
    });
  });

  it("ignores a query string", () => {
    // It is not part of the resource's identity here, and it is the part of a
    // URL most likely to carry something that should not steer a cache.
    expect(invalidationFor({ url: "https://app.test/api/posts?draft=1" }).tags).toEqual([
      { type: "Post", id: "LIST" },
    ]);
  });

  it.each([
    ["a path the table does not name", "https://app.test/api/telemetry"],
    ["a path outside the API prefix", "https://app.test/upload"],
    // An authority that is present and empty: one of the few inputs the
    // parser rejects outright even with a base supplied.
    ["something the URL parser refuses", "http://"],
  ])("invalidates nothing for %s", (_case, url) => {
    /*
      The deliberate half. Invalidating everything for an unmodelled path
      refetches every active query on behalf of a write nobody described — a
      thundering herd at the exact moment a user's connection has just come
      back — and lets this table stay wrong without anyone noticing. A new
      write endpoint gets a row, and this test is what says so.
    */
    expect(invalidationFor({ url })).toEqual({ queryKeys: [], tags: [] });
  });
});

describe("mergeInvalidations", () => {
  it("collapses repeats so one refetch covers a batch", () => {
    // A queue that drained after an hour offline holds many writes against the
    // same collection; invalidating its key once per write is the same refetch
    // several times over.
    const merged = mergeInvalidations([
      { url: "https://app.test/api/posts" },
      { url: "https://app.test/api/posts" },
      { url: "https://app.test/api/posts/7" },
    ]);

    expect(merged.queryKeys).toEqual([POST_FEED_QUERY_KEY, INFINITE_FEED_QUERY_KEY]);
    expect(merged.tags).toEqual([
      { type: "Post", id: "LIST" },
      { type: "Post", id: "7" },
    ]);
  });

  it("returns nothing for writes that name nothing", () => {
    expect(mergeInvalidations([{ url: "https://app.test/api/telemetry" }])).toEqual({
      queryKeys: [],
      tags: [],
    });
  });
});

describe("reconcileReplay", () => {
  it("invalidates the entries a delivered write disturbed", () => {
    const { queryClient, dispatch, invalidated, dispatched } = deps();

    reconcileReplay(
      {
        sent: 1,
        dropped: 0,
        pending: 0,
        writes: [{ method: "POST", url: "https://app.test/api/posts", fate: "sent", status: 201 }],
      },
      { queryClient, dispatch },
    );

    expect(invalidated()).toEqual([
      { queryKey: POST_FEED_QUERY_KEY },
      { queryKey: INFINITE_FEED_QUERY_KEY },
    ]);
    expect(dispatched).toHaveBeenCalledWith(
      baseApi.util.invalidateTags([{ type: "Post", id: "LIST" }]),
    );
  });

  it("invalidates for an abandoned write too", () => {
    /*
      The case this whole module exists for, and the one an implementation that
      only handled `sent` would miss.

      A delivered write makes the cache *stale* — it holds the optimistic guess
      and the server now has the real row. An abandoned write makes it *wrong*:
      the guess is for something that never happened and never will, and
      nothing else in the system will ever correct it.
    */
    const { queryClient, dispatch, invalidated, dispatched } = deps();

    reconcileReplay(
      {
        sent: 0,
        dropped: 1,
        pending: 0,
        writes: [
          { method: "DELETE", url: "https://app.test/api/posts/7", fate: "rejected", status: 409 },
        ],
      },
      { queryClient, dispatch },
    );

    expect(invalidated()).toHaveLength(2);
    expect(dispatched).toHaveBeenCalledWith(
      baseApi.util.invalidateTags([
        { type: "Post", id: "7" },
        { type: "Post", id: "LIST" },
      ]),
    );
  });

  it("invalidates everything when the worker reported no detail", () => {
    /*
      A worker from a previous build answered: counts, no targets. This is the
      one case where invalidating everything is right rather than lazy — a
      write demonstrably finished, nothing says which, and the cost of
      refetching the active queries is bounded while the cost of skipping it is
      a user staring at a row the server does not have. It lasts exactly as
      long as it takes the new worker to claim the tab.
    */
    const { queryClient, dispatch, invalidated, dispatched } = deps();

    reconcileReplay({ sent: 2, dropped: 1, pending: 0, writes: null }, { queryClient, dispatch });

    expect(invalidated()).toEqual([{}]);
    expect(dispatched).toHaveBeenCalledWith(baseApi.util.invalidateTags(["Post", "User"]));
  });

  it("does nothing for a pass where nothing left the queue", () => {
    // Every entry backed off or deferred. The cache is exactly as correct as
    // it was a moment ago, and a refetch would be work done for no change.
    const { queryClient, dispatch, invalidated, dispatched } = deps();

    reconcileReplay({ sent: 0, dropped: 0, pending: 3, writes: [] }, { queryClient, dispatch });

    expect(invalidated()).toEqual([]);
    expect(dispatched).not.toHaveBeenCalled();
  });

  it("dispatches nothing when the writes name no tags", () => {
    const { queryClient, dispatch, invalidated, dispatched } = deps();

    reconcileReplay(
      {
        sent: 1,
        dropped: 0,
        pending: 0,
        writes: [{ method: "POST", url: "https://app.test/api/telemetry", fate: "sent" }],
      },
      { queryClient, dispatch },
    );

    expect(invalidated()).toEqual([]);
    expect(dispatched).not.toHaveBeenCalled();
  });

  it("swallows a refetch that fails", async () => {
    /*
      `invalidateQueries` rejects when a refetch it triggered throws, and the
      queries already have a global error handler (`queryClient.ts`). Letting it
      reject here would turn a GET that timed out into an unhandled rejection
      reported against the offline queue.

      Asserted twice over. The `catch` spy says a handler was attached, and
      Vitest fails a run on an unhandled rejection, so removing the `.catch()`
      in the implementation fails this test even with the assertion deleted.
    */
    const rejection = Promise.reject(new Error("network down"));
    const caught = vi.spyOn(rejection, "catch");
    const queryClient = new QueryClient();
    vi.spyOn(queryClient, "invalidateQueries").mockReturnValue(rejection);

    reconcileReplay(
      {
        sent: 1,
        dropped: 0,
        pending: 0,
        writes: [{ method: "POST", url: "https://app.test/api/posts", fate: "sent" }],
      },
      { queryClient, dispatch: vi.fn() },
    );
    await rejection.catch(() => undefined);

    expect(caught).toHaveBeenCalled();
  });
});

describe("startOfflineReconciliation", () => {
  it("reconciles every replay the client announces, until it is detached", () => {
    const { queryClient, dispatch, invalidated } = deps();
    const client = createStubOfflineClient();
    const stop = startOfflineReconciliation(client, { queryClient, dispatch });

    const pass = {
      sent: 1,
      dropped: 0,
      pending: 0,
      writes: [
        { method: "POST", url: "https://app.test/api/posts", fate: "sent" as const, status: 201 },
      ],
    };
    client.emitReplay(pass);
    expect(invalidated()).toHaveLength(2);

    stop();
    client.emitReplay(pass);
    expect(invalidated()).toHaveLength(2);
  });
});
