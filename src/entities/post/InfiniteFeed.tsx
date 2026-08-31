import { cn } from "@/shared/lib/cn";
import { Skeleton } from "@/shared/ui/Skeleton";
import { VirtualInfiniteList } from "@/shared/ui/performance/VirtualInfiniteList";
import { useInfiniteFeed } from "@/entities/post/useInfiniteFeed";
import type { Post } from "@/entities/post/postsApi";

export interface InfiniteFeedProps {
  /** Height of the scroll container in px. */
  height?: number | undefined;
  /** px before the end of the range at which the next page is requested. */
  prefetchMargin?: number | undefined;
  pageSize?: number | undefined;
  className?: string | undefined;
}

/**
 * The cursor-paginated feed, windowed.
 *
 * The composition is the whole component: `useInfiniteFeed` answers *what* to
 * show and `VirtualInfiniteList` decides *when* more is needed. Neither knows
 * about the other — the list takes items and three flags and would drive any
 * paginated source, and the hook would serve any renderer.
 */
export function InfiniteFeed({ height, prefetchMargin, pageSize, className }: InfiniteFeedProps) {
  const { items, total, hasNextPage, isFetchingNextPage, isPending, error, fetchNextPage } =
    useInfiniteFeed({ pageSize });

  if (isPending) {
    return (
      <div className={cn("flex flex-col gap-3", className)} data-testid="infinite-feed-loading">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <p
        role="alert"
        data-testid="infinite-feed-error"
        className={cn("text-sm text-[var(--color-danger)]", className)}
      >
        Could not load the feed. {error.message}
      </p>
    );
  }

  return (
    <VirtualInfiniteList
      items={items}
      getItemKey={(post) => post.id}
      renderItem={(post, index) => <FeedRow post={post} index={index} />}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      onLoadMore={fetchNextPage}
      label={`Post feed, ${total} items`}
      estimateSize={72}
      height={height}
      prefetchMargin={prefetchMargin}
      className={className}
    />
  );
}

interface FeedRowProps {
  post: Post;
  index: number;
}

function FeedRow({ post, index }: FeedRowProps) {
  return (
    <article className="flex gap-3 border-b border-[var(--color-border)] px-4 py-3">
      <span className="w-10 shrink-0 pt-0.5 text-xs text-[var(--color-muted-fg)] tabular-nums">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-[var(--color-fg)]">{post.title}</h3>
        <p className="truncate text-xs text-[var(--color-muted-fg)]">{post.body}</p>
      </div>
    </article>
  );
}
