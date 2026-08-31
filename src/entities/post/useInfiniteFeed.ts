import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useApiClient } from "@/shared/api/apiClientContext";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import type { Post } from "@/entities/post/postsApi";
import {
  FEED_PAGE_SIZE,
  INFINITE_FEED_QUERY_KEY,
  fetchFeedPage,
  flattenFeedPages,
} from "@/entities/post/infiniteFeed";

export interface UseInfiniteFeedOptions {
  readonly pageSize?: number | undefined;
}

export interface InfiniteFeedState {
  /** Every row loaded so far, flattened and de-duplicated. */
  readonly items: readonly Post[];
  /** Rows the server holds, or `0` before the first page lands. */
  readonly total: number;
  /** Requests that have resolved. One per page, which is the point. */
  readonly pagesLoaded: number;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly fetchNextPage: () => void;
}

/**
 * The infinite feed as one value, shareable by anything that needs it.
 *
 * Returned as a flat object rather than by spreading the query result, so the
 * surface is the eight things a caller uses instead of the forty a
 * `useInfiniteQuery` returns — and so `items` and `total`, which are derived
 * rather than fetched, sit at the same level as the rest.
 *
 * Two components calling this hook with the same `pageSize` share one cache
 * entry, so a page can render the list and its own statistics without either
 * one owning the query or a second request being made. That is TanStack
 * Query's model working as intended, and it is why `/labs/infinite-scroll`
 * needs no state of its own.
 *
 * `pageSize` is in the query key because it changes what a page *is*: two
 * components asking for different sizes are asking different questions, and
 * sharing a cache entry between them would serve one of them another's rows.
 */
export function useInfiniteFeed({
  pageSize = FEED_PAGE_SIZE,
}: UseInfiniteFeedOptions = {}): InfiniteFeedState {
  const client = useApiClient();

  const query = useInfiniteQuery({
    queryKey: [...INFINITE_FEED_QUERY_KEY, pageSize],
    queryFn: ({ pageParam, signal }) =>
      fetchFeedPage(client, { cursor: pageParam, limit: pageSize, signal }),
    initialPageParam: null as string | null,
    // `null` is the server saying "no more"; TanStack reads that as
    // `hasNextPage === false`, which is what unmounts the sentinel.
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    retry: false,
  });

  const pages = query.data?.pages;
  const items = useMemo(() => flattenFeedPages(pages ?? []), [pages]);

  // `query.fetchNextPage` is already stable and returns a promise nobody here
  // awaits; this wrapper drops the promise and keeps one identity for it, so a
  // caller may put it in an effect's dependencies without arming a loop.
  const fetchNextPage = useStableCallback(() => {
    void query.fetchNextPage();
  });

  return {
    items,
    // Read from the newest page rather than the first: a feed that grew while
    // the user was scrolling should report what the server says now.
    total: pages?.[pages.length - 1]?.total ?? 0,
    pagesLoaded: pages?.length ?? 0,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isPending: query.isPending,
    error: query.error,
    fetchNextPage,
  };
}
