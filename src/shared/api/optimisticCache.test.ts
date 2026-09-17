import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueryClient, QueryObserver, type QueryKey } from "@tanstack/react-query";
import { beginOptimisticUpdate } from "@/shared/api/optimisticCache";

interface Row {
  readonly id: string;
  readonly label: string;
}

const SCOPE = ["rows", "list"];
const OPEN = ["rows", "list", "open"];
const DONE = ["rows", "list", "done"];

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

const rows = (...labels: string[]): Row[] => labels.map((label) => ({ id: label, label }));
const labelsOf = (client: QueryClient, key: readonly unknown[]): string[] =>
  (client.getQueryData<Row[]>(key) ?? []).map((row) => row.label);

const append =
  (label: string) =>
  (previous: readonly Row[]): readonly Row[] => [...previous, { id: label, label }];

/**
 * Mount a real observer on a key that already holds data.
 *
 * `invalidateQueries` refetches *active* queries, so a test about what the
 * server says next has to have something watching — a cache entry with no
 * observer is only marked stale, which is a different (and separately tested)
 * behaviour. This is the `useQuery` in a mounted component, minus React.
 *
 * `staleTime: Infinity` so that mounting does not itself fetch; an invalidation
 * refetches an active query regardless of staleness, which is the only fetch
 * these tests want to observe.
 */
function observe<T>(key: QueryKey, queryFn: () => T | Promise<T>): () => void {
  const observer = new QueryObserver<T, Error, T, T, QueryKey>(client, {
    queryKey: key,
    queryFn,
    retry: false,
    staleTime: Infinity,
  });
  return observer.subscribe(() => {});
}

let client: QueryClient;

beforeEach(() => {
  client = makeClient();
});

describe("beginOptimisticUpdate", () => {
  it("writes the patch into every cached entry under the key", () => {
    client.setQueryData(OPEN, rows("a"));
    client.setQueryData(DONE, rows("z"));

    beginOptimisticUpdate<readonly Row[]>(client, { queryKey: SCOPE }, append("new"));

    expect(labelsOf(client, OPEN)).toEqual(["a", "new"]);
    expect(labelsOf(client, DONE)).toEqual(["z", "new"]);
  });

  it("hands each entry its own key so one change can read differently per view", () => {
    client.setQueryData(OPEN, rows("a"));
    client.setQueryData(DONE, rows("z"));

    beginOptimisticUpdate<readonly Row[]>(client, { queryKey: SCOPE }, (previous, queryKey) =>
      queryKey[2] === "open" ? previous : [...previous, { id: "moved", label: "moved" }],
    );

    expect(labelsOf(client, OPEN)).toEqual(["a"]);
    expect(labelsOf(client, DONE)).toEqual(["z", "moved"]);
  });

  it("leaves entries outside the key alone", () => {
    client.setQueryData(OPEN, rows("a"));
    client.setQueryData(["rows", "stats"], { total: 1 });

    beginOptimisticUpdate<readonly Row[]>(client, { queryKey: SCOPE }, append("new"));

    expect(client.getQueryData(["rows", "stats"])).toEqual({ total: 1 });
  });

  it("skips entries that have never resolved rather than patching undefined", () => {
    // A query object exists (something mounted it) but no fetch has landed.
    client.getQueryCache().build(client, { queryKey: OPEN });

    expect(() => {
      beginOptimisticUpdate<readonly Row[]>(client, { queryKey: SCOPE }, append("new"));
    }).not.toThrow();
    expect(client.getQueryData(OPEN)).toBeUndefined();
  });

  it("restores the server's value on rollback", async () => {
    client.setQueryData(OPEN, rows("a"));

    const handle = beginOptimisticUpdate<readonly Row[]>(
      client,
      { queryKey: SCOPE },
      append("new"),
    );
    expect(labelsOf(client, OPEN)).toEqual(["a", "new"]);

    await handle.settle("error");

    expect(labelsOf(client, OPEN)).toEqual(["a"]);
  });

  it("is a no-op when the same handle settles twice", async () => {
    client.setQueryData(OPEN, rows("a"));

    const handle = beginOptimisticUpdate<readonly Row[]>(
      client,
      { queryKey: SCOPE },
      append("new"),
    );
    await handle.settle("error");
    await handle.settle("success");

    expect(labelsOf(client, OPEN)).toEqual(["a"]);
  });
});

describe("overlapping mutations", () => {
  it("keeps a second mutation's row when the first rolls back", async () => {
    client.setQueryData(OPEN, rows("a"));

    const first = beginOptimisticUpdate<readonly Row[]>(client, { queryKey: SCOPE }, append("one"));
    const second = beginOptimisticUpdate<readonly Row[]>(
      client,
      { queryKey: SCOPE },
      append("two"),
    );
    expect(labelsOf(client, OPEN)).toEqual(["a", "one", "two"]);

    // This is the case snapshot-and-restore gets wrong: `first`'s snapshot was
    // taken before `second` existed, so writing it back would drop "two".
    await first.settle("error");

    expect(labelsOf(client, OPEN)).toEqual(["a", "two"]);

    await second.settle("error");
    expect(labelsOf(client, OPEN)).toEqual(["a"]);
  });

  it("does not invalidate until every mutation in the scope has settled", async () => {
    client.setQueryData(OPEN, rows("a"));
    const invalidate = vi.spyOn(client, "invalidateQueries");

    const first = beginOptimisticUpdate<readonly Row[]>(client, { queryKey: SCOPE }, append("one"));
    const second = beginOptimisticUpdate<readonly Row[]>(
      client,
      { queryKey: SCOPE },
      append("two"),
    );

    await first.settle("success");
    expect(invalidate).not.toHaveBeenCalled();

    await second.settle("success");
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("invalidates the union of the keys the mutations declared", async () => {
    client.setQueryData(OPEN, rows("a"));
    const invalidate = vi.spyOn(client, "invalidateQueries");

    const first = beginOptimisticUpdate<readonly Row[]>(
      client,
      { queryKey: SCOPE, invalidateKeys: [["rows"]] },
      append("one"),
    );
    const second = beginOptimisticUpdate<readonly Row[]>(
      client,
      { queryKey: SCOPE, invalidateKeys: [["rows"], ["audit"]] },
      append("two"),
    );

    await first.settle("success");
    await second.settle("success");

    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ["rows"],
      ["audit"],
    ]);
  });
});

describe("refetches that land while a guess is up", () => {
  it("re-applies the patch on top of a response that arrives mid-flight", async () => {
    client.setQueryData(OPEN, rows("a"));
    beginOptimisticUpdate<readonly Row[]>(client, { queryKey: SCOPE }, append("new"));

    // A fetch that started *after* `onMutate` — a refocus, a remount, an
    // interval. `cancelQueries` cannot reach it, and the plain recipe loses
    // the optimistic row here.
    await client.fetchQuery({ queryKey: OPEN, queryFn: () => rows("a", "b") });

    expect(labelsOf(client, OPEN)).toEqual(["a", "b", "new"]);
  });

  it("rolls back to the refetched value, not to the value from before it", async () => {
    client.setQueryData(OPEN, rows("a"));
    const handle = beginOptimisticUpdate<readonly Row[]>(
      client,
      { queryKey: SCOPE },
      append("new"),
    );

    await client.fetchQuery({ queryKey: OPEN, queryFn: () => rows("a", "b") });
    await handle.settle("error");

    expect(labelsOf(client, OPEN)).toEqual(["a", "b"]);
  });

  it("adopts an entry that only appears while the mutation is in flight", async () => {
    client.setQueryData(OPEN, rows("a"));
    beginOptimisticUpdate<readonly Row[]>(client, { queryKey: SCOPE }, append("new"));

    // Nothing had asked for the "done" list when the guess was made.
    await client.fetchQuery({ queryKey: DONE, queryFn: () => rows("z") });

    expect(labelsOf(client, DONE)).toEqual(["z", "new"]);
  });

  it("forgets an entry that is removed from the cache", async () => {
    client.setQueryData(OPEN, rows("a"));
    client.setQueryData(DONE, rows("z"));
    const handle = beginOptimisticUpdate<readonly Row[]>(
      client,
      { queryKey: SCOPE },
      append("new"),
    );

    client.removeQueries({ queryKey: DONE });
    await handle.settle("error");

    expect(labelsOf(client, OPEN)).toEqual(["a"]);
    expect(client.getQueryData(DONE)).toBeUndefined();
  });
});

describe("handing back to the server", () => {
  it("keeps the guess applied until the invalidation has refetched", async () => {
    // The seam this closes: drop the patch when the request resolves and the
    // row disappears for however long the refetch takes.
    let serverRows = rows("a");
    const seen: string[][] = [];

    client.setQueryData(OPEN, serverRows);
    const stop = observe(OPEN, () => serverRows);
    const unsubscribe = client.getQueryCache().subscribe(() => {
      seen.push(labelsOf(client, OPEN));
    });

    const handle = beginOptimisticUpdate<readonly Row[]>(
      client,
      { queryKey: SCOPE, invalidateKeys: [OPEN] },
      append("new"),
    );

    // The server now agrees, and answers the invalidation with the real row.
    serverRows = rows("a", "new");
    await handle.settle("success");
    unsubscribe();
    stop();

    expect(labelsOf(client, OPEN)).toEqual(["a", "new"]);
    // Not once did the list go back to just ["a"].
    expect(seen).not.toContainEqual(["a"]);
  });

  it("lets the server overrule the guess once it has answered", async () => {
    let serverRows = rows("a");
    client.setQueryData(OPEN, serverRows);
    const stop = observe(OPEN, () => serverRows);

    const handle = beginOptimisticUpdate<readonly Row[]>(
      client,
      { queryKey: SCOPE, invalidateKeys: [OPEN] },
      append("guessed"),
    );

    // The server accepted the write but normalised it to something else.
    serverRows = rows("a", "normalised");
    await handle.settle("success");
    stop();

    expect(labelsOf(client, OPEN)).toEqual(["a", "normalised"]);
  });

  it("keeps the guess on an entry nothing is observing, rather than reverting it", async () => {
    // `invalidateQueries` does not refetch an inactive query, so there is no
    // fresh server value to hand back to. Writing the pre-mutation value there
    // would make the next mount render a list without the new row for a frame.
    client.setQueryData(OPEN, rows("a"));

    const handle = beginOptimisticUpdate<readonly Row[]>(
      client,
      { queryKey: SCOPE },
      append("new"),
    );
    await handle.settle("success");

    expect(labelsOf(client, OPEN)).toEqual(["a", "new"]);
    expect(client.getQueryState(OPEN)?.isInvalidated).toBe(true);
  });

  it("stops listening to the cache once the scope goes quiet", async () => {
    client.setQueryData(OPEN, rows("a"));
    const handle = beginOptimisticUpdate<readonly Row[]>(
      client,
      { queryKey: SCOPE },
      append("new"),
    );
    await handle.settle("error");

    // If the subscription outlived the scope, this response would come back
    // with "new" re-applied on top of it.
    await client.fetchQuery({ queryKey: OPEN, queryFn: () => rows("a", "b") });

    expect(labelsOf(client, OPEN)).toEqual(["a", "b"]);
  });

  it("keeps confirmed guesses applied when a new mutation starts mid-reconcile", async () => {
    let serverRows = rows("a");
    let releaseRefetch = (): void => {};
    let announceRefetch = (): void => {};
    const refetchStarted = new Promise<void>((resolve) => {
      announceRefetch = resolve;
    });

    client.setQueryData(OPEN, serverRows);
    const stop = observe(OPEN, async () => {
      const held = new Promise<void>((release) => {
        releaseRefetch = release;
      });
      announceRefetch();
      await held;
      return serverRows;
    });

    const first = beginOptimisticUpdate<readonly Row[]>(
      client,
      { queryKey: SCOPE, invalidateKeys: [OPEN] },
      append("one"),
    );

    // The server accepted it, so its next answer will contain the row.
    serverRows = rows("a", "one");
    const settling = first.settle("success");
    await refetchStarted;

    // A second change begins while the invalidation is still in the air.
    const second = beginOptimisticUpdate<readonly Row[]>(
      client,
      { queryKey: SCOPE },
      append("two"),
    );
    releaseRefetch();
    await settling;
    stop();

    // The refetch supersedes the first guess without dropping the second, and
    // the scope stays open because "two" has not settled.
    expect(labelsOf(client, OPEN)).toEqual(["a", "one", "two"]);

    await second.settle("error");
    expect(labelsOf(client, OPEN)).toEqual(["a", "one"]);
  });

  it("does not report a failed invalidation as a failed mutation", async () => {
    client.setQueryData(OPEN, rows("a"));
    vi.spyOn(client, "invalidateQueries").mockRejectedValueOnce(new Error("offline"));

    const handle = beginOptimisticUpdate<readonly Row[]>(
      client,
      { queryKey: SCOPE },
      append("new"),
    );

    // Rejecting here would reach `onSettled`, and TanStack reads a rejected
    // `onSettled` as the mutation failing — a write the server accepted would
    // announce itself as reverted because a GET afterwards timed out.
    await expect(handle.settle("success")).resolves.toBeUndefined();

    // The guess is still the best value on record: the server accepted it and
    // never got to answer. What must not survive is the scope — the next
    // response replaces the entry outright rather than having "new" re-applied
    // on top of it.
    expect(labelsOf(client, OPEN)).toEqual(["a", "new"]);
    await client.fetchQuery({ queryKey: OPEN, queryFn: () => rows("a", "b") });
    expect(labelsOf(client, OPEN)).toEqual(["a", "b"]);
  });
});
