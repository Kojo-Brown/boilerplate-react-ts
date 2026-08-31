import type { ApiClient } from "@/shared/api/apiClient";
import type { Post } from "@/entities/post/postsApi";

/**
 * A cursor-paginated feed, read through an injected {@link ApiClient}.
 *
 * The sibling of `postFeed.ts`, which reads the same resource in one shot. The
 * difference is not the transport, it is that this one has an *end* the client
 * discovers rather than knows: each response carries the cursor for the page
 * after it, and `null` is how the server says there is no more. A page count
 * or an offset would work for a static list and would be wrong for a feed —
 * rows inserted while the user is scrolling shift every offset after them, so
 * the same row is served twice or skipped entirely.
 *
 * See `docs/windowed-infinite-scroll.md`.
 */

export const INFINITE_FEED_QUERY_KEY = ["infinite-feed"] as const;

/** Rows per request. Large enough that a flick does not outrun the prefetch. */
export const FEED_PAGE_SIZE = 50;

export interface FeedPage {
  readonly items: readonly Post[];
  /** Cursor for the page after this one; `null` at the end of the feed. */
  readonly nextCursor: string | null;
  /** Rows the server holds in total, for the status line. */
  readonly total: number;
}

export interface FetchFeedPageParams {
  /** `null` (or absent) asks for the first page. */
  readonly cursor?: string | null | undefined;
  readonly limit?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * The request path for one page.
 *
 * Split out because it is the one part of this module a test can assert
 * cheaply and exactly — `createStubApiClient` matches routes by their full
 * `"GET /feed?cursor=…&limit=…"` string, so the parameter *order* here is part
 * of the contract between the feed and every stub that answers it.
 */
export function feedPagePath(cursor?: string | null, limit: number = FEED_PAGE_SIZE): string {
  const params = new URLSearchParams();
  if (cursor != null && cursor !== "") params.set("cursor", cursor);
  params.set("limit", String(limit));
  return `/feed?${params.toString()}`;
}

/** `GET /feed`. `signal` comes from TanStack Query and cancels the request. */
export function fetchFeedPage(
  client: ApiClient,
  { cursor = null, limit = FEED_PAGE_SIZE, signal }: FetchFeedPageParams = {},
): Promise<FeedPage> {
  return client.get<FeedPage>(feedPagePath(cursor, limit), { signal });
}

/**
 * Flatten loaded pages into the single ordered array the list renders.
 *
 * De-duplicates by `id`, which is not defensive programming — it is the direct
 * consequence of the cursor being a position in a feed that is still being
 * written to. Insert a row above the cursor between two requests and the row
 * that was last on page *n* is first on page *n+1*.
 *
 * Two rows sharing an id would be a duplicate React key, which React reports,
 * and a duplicate *virtualizer item key*, which nothing reports: the
 * virtualizer caches one measured height per key, so two indices would write
 * to and read from a single cache entry, and the scroll range would be wrong
 * by their difference for as long as both are loaded.
 */
export function flattenFeedPages(pages: readonly FeedPage[]): Post[] {
  const seen = new Set<number>();
  const items: Post[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  return items;
}
