import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/shared/api/apiClientContext";
import { cn } from "@/shared/lib/cn";
import { Skeleton } from "@/shared/ui/Skeleton";
import { useAsyncStatusAnnouncement } from "@/shared/a11y/useAsyncStatusAnnouncement";
import { POST_FEED_QUERY_KEY, fetchPostFeed } from "@/entities/post/postFeed";

/**
 * What the live region says once the feed has loaded.
 *
 * The count, because that is the part a listening user cannot get from the
 * skeleton disappearing. "Loaded" would tell them only that something happened.
 */
function loadedAnnouncement(count: number): string {
  if (count === 0) return "No posts";
  return count === 1 ? "1 post loaded" : `${count} posts loaded`;
}

export interface PostFeedProps {
  className?: string | undefined;
}

/**
 * The feed, rendered from whichever {@link import("@/shared/api/apiClient").ApiClient}
 * is above it.
 *
 * There is no import of a client here and no prop for one — the component asks
 * context and gets whatever its host published. That is the whole demonstration:
 * in the browser this is the real `fetch` client from `main.tsx`, in
 * `PostFeed.test.tsx` it is `createStubApiClient`, and on `/labs/dependency-inversion`
 * it is whichever of the two the page has selected. None of those hosts required
 * a change here.
 *
 * The query key does not include the client, and it should not: a cache entry
 * is keyed by what was asked for, not by who was asked. The consequence is that
 * a host swapping the client has to swap the `QueryClient` with it, or the new
 * client's first render serves the previous one's cached rows — which is why
 * `renderWithProviders` builds a fresh `QueryClient` per test and why the lab
 * page gives its stub subtree its own. Encoding the client in the key would
 * paper over that and hide a real bug: a component that captured its client on
 * first render would still look like it was swapping.
 */
export function PostFeed({ className }: PostFeedProps) {
  const client = useApiClient();
  const { data, error, isPending, status } = useQuery({
    queryKey: POST_FEED_QUERY_KEY,
    // `signal` comes from TanStack Query and is forwarded to the client, so an
    // unmount mid-flight aborts the request instead of resolving into nothing.
    queryFn: ({ signal }) => fetchPostFeed(client, { signal }),
    retry: false,
  });

  /*
   * The skeleton below says "loading" to anyone who can see it and nothing at
   * all to anyone who cannot: `Skeleton` is `aria-hidden` by design, so a screen
   * full of placeholder bars is not read out one bar at a time, and this
   * component's loading branch is a plain `<div>` around two of them. The load
   * and its result were both silent before this.
   *
   * `status` rather than `isFetching`, so a background refetch that has data to
   * show says nothing; see `useAsyncStatusAnnouncement`. The first load is
   * announced because the status *changes* out of `pending`, and nothing is
   * announced on arrival with a warm cache.
   *
   * `error` is `null` on purpose and is not an omission: the paragraph below is
   * `role="alert"` and announces itself when it appears. Announcing here as well
   * would say it twice, once per region, which is the failure mode that made the
   * nested live region in `Toast` invisible for as long as it was.
   */
  useAsyncStatusAnnouncement({
    status,
    messages: {
      pending: "Loading posts",
      success: data === undefined ? null : loadedAnnouncement(data.length),
      error: null,
    },
  });

  if (isPending) {
    return (
      <div className={cn("flex flex-col gap-3", className)} data-testid="post-feed-loading">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-6 w-1/2" />
      </div>
    );
  }

  if (error) {
    return (
      <p
        role="alert"
        data-testid="post-feed-error"
        className={cn("text-sm text-[var(--color-danger)]", className)}
      >
        Could not load posts. {error.message}
      </p>
    );
  }

  return (
    <ul className={cn("flex flex-col gap-3", className)} data-testid="post-feed">
      {data.map((post) => (
        <li
          key={post.id}
          className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4"
        >
          <h3 className="font-semibold text-[var(--color-fg)]">{post.title}</h3>
          <p className="text-sm text-[var(--color-muted-fg)]">{post.body}</p>
        </li>
      ))}
    </ul>
  );
}
