import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { baseApi } from "@/shared/api/baseApi";
import { API_PREFIX } from "@/shared/offline/config";
import type { ReplayedWrite } from "@/shared/offline/messages";
import type { OfflineClient, ReplayEvent } from "@/shared/offline/offlineClient";
import { INFINITE_FEED_QUERY_KEY } from "@/entities/post/infiniteFeed";
import { POST_FEED_QUERY_KEY } from "@/entities/post/postFeed";

/**
 * Reconciling the application's caches with a write queue that has drained.
 *
 * This is the half of offline support that `shared/offline` deliberately does
 * not contain. The worker knows a `PUT /api/posts/7` was delivered four hours
 * after the user made it; it has no idea that this application keeps posts in
 * both a TanStack Query entry and an RTK Query tag, and teaching it would make
 * a service worker depend on the cache layout of the page it serves. So the
 * worker reports what left the queue, and the mapping from a URL to the
 * entries that URL makes stale lives here, in the composition root, next to
 * the two caches it names.
 *
 * Both fates need it, and the abandoned one needs it more. A delivered write
 * makes the cache stale — it holds the optimistic guess, and the server now
 * has the real row. An *abandoned* write makes the cache wrong: the guess is
 * for something that never happened and never will, and nothing else in the
 * system will ever correct it. That asymmetry is why `dropped` is not simply
 * counted and shown.
 */

/** The cache entries one write disturbs. */
export interface CacheInvalidation {
  readonly queryKeys: readonly QueryKey[];
  /** RTK Query tags, in the vocabulary `baseApi` declares. */
  readonly tags: readonly { readonly type: "Post" | "User"; readonly id?: string }[];
}

const NOTHING: CacheInvalidation = { queryKeys: [], tags: [] };

/**
 * What a replayed write invalidates, by the path it was sent to.
 *
 * Read as: the API path with {@link API_PREFIX} removed, split on `/`. Only
 * same-origin writes under that prefix are ever queued (`shared/offline/routing.ts`),
 * so nothing else can arrive here.
 *
 * **An unrecognised path invalidates nothing**, and that is the deliberate
 * half. The alternative — a bare `invalidateQueries()` for anything the table
 * does not name — refetches every active query in the application on behalf of
 * a write nobody modelled, which is both a thundering herd at the exact moment
 * a user's connection has just come back and a way for this table to stay
 * wrong without anyone noticing. A new write endpoint gets a row here, and the
 * test below fails until it does.
 */
function invalidationForPath(
  segments: readonly string[],
  id: string | undefined,
): CacheInvalidation {
  if (segments[0] !== "posts") return NOTHING;
  return {
    // Both feeds read posts and neither can know a write happened: the feed is
    // a plain query and the infinite feed is keyed by page size, which prefix
    // matching covers.
    queryKeys: [POST_FEED_QUERY_KEY, INFINITE_FEED_QUERY_KEY],
    tags:
      id === undefined
        ? [{ type: "Post", id: "LIST" }]
        : // The row *and* the list: a delete removes it from both, and a
          // create against `/posts` has no id to name.
          [
            { type: "Post", id },
            { type: "Post", id: "LIST" },
          ],
  };
}

/** The entries one replayed write makes stale or wrong. */
export function invalidationFor(write: Pick<ReplayedWrite, "url">): CacheInvalidation {
  let pathname: string;
  try {
    // A base is supplied because a queued URL is absolute in practice and the
    // parser must not throw if one ever is not — this runs on the path where
    // the network has just returned, and an exception here would take the
    // reconciliation for every *other* write down with it.
    pathname = new URL(write.url, "http://invalid.localhost").pathname;
  } catch {
    return NOTHING;
  }
  if (!pathname.startsWith(API_PREFIX)) return NOTHING;

  const segments = pathname.slice(API_PREFIX.length).split("/").filter(Boolean);
  return invalidationForPath(segments, segments[1]);
}

/** Folds a pass's worth of writes into one invalidation, without duplicates. */
export function mergeInvalidations(
  writes: readonly Pick<ReplayedWrite, "url">[],
): CacheInvalidation {
  const queryKeys = new Map<string, QueryKey>();
  const tags = new Map<string, { readonly type: "Post" | "User"; readonly id?: string }>();
  for (const write of writes) {
    const invalidation = invalidationFor(write);
    for (const key of invalidation.queryKeys) queryKeys.set(JSON.stringify(key), key);
    for (const tag of invalidation.tags) tags.set(`${tag.type}:${tag.id ?? ""}`, tag);
  }
  return { queryKeys: [...queryKeys.values()], tags: [...tags.values()] };
}

export interface ReconcileDeps {
  readonly queryClient: QueryClient;
  readonly dispatch: (action: ReturnType<typeof baseApi.util.invalidateTags>) => void;
}

/**
 * Applies one replay pass to both caches.
 *
 * The `writes === null` branch is the one worth reading twice. It means a
 * worker from a previous build answered — it reported counts and no detail —
 * and it is the one case where invalidating everything is right rather than
 * lazy: a write demonstrably finished, nothing says which, and the cost of
 * refetching the active queries is bounded while the cost of skipping it is a
 * user staring at a row the server does not have. It lasts exactly as long as
 * it takes the new worker to claim the tab.
 */
export function reconcileReplay(event: ReplayEvent, deps: ReconcileDeps): void {
  if (event.sent === 0 && event.dropped === 0) return;

  if (event.writes === null) {
    swallow(deps.queryClient.invalidateQueries());
    deps.dispatch(baseApi.util.invalidateTags(["Post", "User"]));
    return;
  }

  const { queryKeys, tags } = mergeInvalidations(event.writes);
  for (const queryKey of queryKeys) swallow(deps.queryClient.invalidateQueries({ queryKey }));
  if (tags.length > 0) deps.dispatch(baseApi.util.invalidateTags([...tags]));
}

/**
 * A refetch that fails is not this pass's problem.
 *
 * `invalidateQueries` resolves when the refetches it triggered settle, and it
 * rejects when one of them throws. Letting that reject here would turn a GET
 * that timed out into an unhandled rejection reported against the offline
 * queue — and the queries themselves already have a global error handler
 * (`queryClient.ts`) that is a much better place to hear about it.
 */
function swallow(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

/**
 * Wires the offline client's replay events to both caches.
 *
 * Returns the unsubscribe, which nothing in `main.tsx` calls — the application
 * lives as long as the page does. It exists so a test can prove the listener
 * detaches, and so this module never becomes the reason a future host cannot
 * tear the application down.
 */
export function startOfflineReconciliation(client: OfflineClient, deps: ReconcileDeps): () => void {
  return client.onReplay((event) => {
    reconcileReplay(event, deps);
  });
}
