import { describe, it, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  useIsMutating,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useOptimisticMutation } from "@/shared/api/useOptimisticMutation";

interface Row {
  readonly id: string;
}

const SCOPE = ["rows", "list"];
const OPEN = ["rows", "list", "open"];

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const ids = (client: QueryClient): string[] =>
  (client.getQueryData<Row[]>(OPEN) ?? []).map((row) => row.id);

describe("useOptimisticMutation", () => {
  it("writes the guess before the request resolves and keeps it on success", async () => {
    const client = makeClient();
    client.setQueryData(OPEN, [{ id: "a" }]);

    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { result } = renderHook(
      () =>
        useOptimisticMutation<readonly Row[], string>({
          queryKey: SCOPE,
          mutationFn: () => held,
          patch: (rows, id) => [...rows, { id }],
        }),
      { wrapper: wrapper(client) },
    );

    act(() => {
      result.current.mutate("new");
    });

    await waitFor(() => {
      expect(ids(client)).toEqual(["a", "new"]);
    });
    expect(result.current.isPending).toBe(true);

    await act(async () => {
      release();
      await held;
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(ids(client)).toEqual(["a", "new"]);
  });

  it("takes the guess back off when the request fails", async () => {
    const client = makeClient();
    client.setQueryData(OPEN, [{ id: "a" }]);
    const onError = vi.fn();

    const { result } = renderHook(
      () =>
        useOptimisticMutation<readonly Row[], string>({
          queryKey: SCOPE,
          mutationFn: () => Promise.reject(new Error("rejected")),
          patch: (rows, id) => [...rows, { id }],
          onError,
        }),
      { wrapper: wrapper(client) },
    );

    act(() => {
      result.current.mutate("new");
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(ids(client)).toEqual(["a"]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "new");
  });

  it("cancels in-flight fetches for the key before writing", async () => {
    const client = makeClient();
    client.setQueryData(OPEN, [{ id: "a" }]);
    const cancel = vi.spyOn(client, "cancelQueries");

    const { result } = renderHook(
      () =>
        useOptimisticMutation<readonly Row[], string>({
          queryKey: SCOPE,
          mutationFn: () => Promise.resolve(),
          patch: (rows, id) => [...rows, { id }],
        }),
      { wrapper: wrapper(client) },
    );

    await act(async () => {
      await result.current.mutateAsync("new");
    });

    expect(cancel).toHaveBeenCalledWith({ queryKey: SCOPE });
  });

  it("stays pending until the invalidation has refetched", async () => {
    // The point of returning the settle promise from `onSettled`: a button that
    // re-enables on `isPending` should re-enable when the screen is true, not
    // when the socket closed.
    const client = makeClient();
    let releaseRefetch = (): void => {};
    const refetching = new Promise<void>((resolve) => {
      releaseRefetch = resolve;
    });

    client.setQueryData(OPEN, [{ id: "a" }]);
    client.setQueryDefaults(OPEN, {
      queryFn: async () => {
        await refetching;
        return [{ id: "a" }, { id: "new" }];
      },
      staleTime: Infinity,
    });
    // An observer, so `invalidateQueries` actually refetches: it refetches
    // active queries and only marks the rest stale.
    const observer = new QueryObserver(client, { queryKey: OPEN });
    const stopObserving = observer.subscribe(() => {});

    const { result } = renderHook(
      () => ({
        mutation: useOptimisticMutation<readonly Row[], string>({
          queryKey: SCOPE,
          invalidateKeys: [OPEN],
          mutationFn: () => Promise.resolve(),
          patch: (rows, id) => [...rows, { id }],
        }),
        // Reactive, and scoped by the mutation key the hook sets for us.
        settling: useIsMutating({ mutationKey: SCOPE }),
      }),
      { wrapper: wrapper(client) },
    );

    act(() => {
      result.current.mutation.mutate("new");
    });

    await waitFor(() => {
      expect(result.current.settling).toBe(1);
    });

    // The request itself resolved long ago; the scope has not.
    await act(async () => {
      releaseRefetch();
      await refetching;
    });

    await waitFor(() => {
      expect(result.current.settling).toBe(0);
    });
    stopObserving();
  });

  it("rolls one mutation back without disturbing another in flight", async () => {
    const client = makeClient();
    client.setQueryData(OPEN, [{ id: "a" }]);

    let releaseSlow = (): void => {};
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    // Held rather than rejected up front, so both guesses are provably on
    // screen at the same time before either settles. That overlap is the whole
    // scenario — a rollback that arrives while somebody else is still guessing.
    let rejectDoomed = (_error: Error): void => {};
    const doomed = new Promise<void>((_resolve, reject) => {
      rejectDoomed = reject;
    });

    const { result } = renderHook(
      () => ({
        failing: useOptimisticMutation<readonly Row[], string>({
          queryKey: SCOPE,
          mutationFn: () => doomed,
          patch: (rows, id) => [...rows, { id }],
        }),
        slow: useOptimisticMutation<readonly Row[], string>({
          queryKey: SCOPE,
          mutationFn: () => slow,
          patch: (rows, id) => [...rows, { id }],
        }),
      }),
      { wrapper: wrapper(client) },
    );

    act(() => {
      result.current.failing.mutate("doomed");
      result.current.slow.mutate("survivor");
    });

    await waitFor(() => {
      expect(ids(client)).toEqual(["a", "doomed", "survivor"]);
    });

    await act(async () => {
      rejectDoomed(new Error("no"));
      await doomed.catch(() => undefined);
    });

    await waitFor(() => {
      expect(result.current.failing.isError).toBe(true);
    });
    expect(ids(client)).toEqual(["a", "survivor"]);

    await act(async () => {
      releaseSlow();
      await slow;
    });
    await waitFor(() => {
      expect(result.current.slow.isSuccess).toBe(true);
    });
  });
});
