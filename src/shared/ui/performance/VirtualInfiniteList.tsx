import { useEffect, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/shared/lib/cn";
import { useIntersection } from "@/shared/hooks/useIntersection";
import { useStableCallback } from "@/shared/hooks/useStableCallback";

export interface VirtualInfiniteListProps<TItem> {
  /** Every item loaded so far, in order. Pages are already flattened. */
  items: readonly TItem[];
  /**
   * A stable identity per item, used as the React key *and* as the
   * virtualizer's item key.
   *
   * Not optional, and not defaulted to the index. The virtualizer caches a
   * measured height per key, so with index keys the cache is a claim about
   * *positions* rather than about rows — correct while pages only ever append,
   * wrong the moment anything is prepended, filtered or removed, and wrong in
   * the way that is hardest to see: rows keep their old neighbours' heights
   * and the scroll range is off by the difference.
   */
  getItemKey: (item: TItem, index: number) => string | number;
  renderItem: (item: TItem, index: number) => React.ReactNode;
  /** Whether another page exists. Controls whether the sentinel is mounted. */
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** Asked for the next page. Called at most once per settled fetch. */
  onLoadMore: () => void;
  /** Accessible name for the list. */
  label: string;
  /** Estimated row height in px, used before a row has been measured. */
  estimateSize?: number | undefined;
  /** Height of the scroll container in px. */
  height?: number | undefined;
  /** Rows rendered beyond each edge of the window. */
  overscan?: number | undefined;
  /**
   * How many px before the end of the scroll range loading starts.
   *
   * `0` is the familiar "load when you hit the bottom", which always shows the
   * user a spinner: the request cannot start until they have arrived. Anything
   * larger buys the round trip back — at 400px and a typical flick, the next
   * page is in the cache before the rows that needed it are on screen.
   */
  prefetchMargin?: number | undefined;
  className?: string | undefined;
}

/**
 * A windowed list that loads more as you approach the end.
 *
 * Windowing and infinite loading are each ordinary on their own, and putting
 * them together breaks the usual way of doing the second one. The standard
 * infinite-scroll sentinel is an element rendered *after the last row*; under
 * virtualization the last row is not in the DOM until you have scrolled to it,
 * so a sentinel rendered among the rows does not exist to be observed, and one
 * rendered after them can only be reached by scrolling the whole range. Either
 * way the observer has nothing to say until the user is already at the bottom,
 * which is the outcome prefetching exists to avoid.
 *
 * What makes it work is that a virtualized list has a real element the height
 * of the *whole* range — the spacer — and the sentinel sits after it, always
 * mounted, at a fixed 1px. `rootMargin` then moves the trip point up by
 * {@link VirtualInfiniteListProps.prefetchMargin} px without moving the
 * element, and because the observer's root is the scroll container that margin
 * means what it says. Against the default root (the viewport) it would not:
 * the margin grows the *root's* box, so a bottom margin would ask how far past
 * the browser window the sentinel is, a question that never comes true for an
 * element clipped inside an inner scroller. The prefetch would silently
 * degrade to loading at the bottom — visibly identical to a working
 * implementation on a fast connection.
 *
 * The other half is that loading is driven by intersection *state* in an
 * effect, not by the observer callback. An observer reports transitions, and
 * "the page you asked for arrived and the sentinel is still in view" is not
 * one: no boundary is crossed, no callback fires, and loading stalls with the
 * sentinel sitting in the viewport until the user scrolls again to dislodge
 * it. That happens whenever a page is shorter than the prefetch margin, which
 * is to say on every short page and on the last few pages of most feeds.
 * Re-running the effect on `isFetchingNextPage` is what continues the chain.
 *
 * `onLoadMore` is passed through `useStableCallback` for the same reason: the
 * effect depends on it, and a caller writing `onLoadMore={() => fetchNextPage()}`
 * would otherwise hand it a new identity every render and turn one prefetch
 * into a fetch per commit.
 */
export function VirtualInfiniteList<TItem>({
  items,
  getItemKey,
  renderItem,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  label,
  estimateSize = 64,
  height = 400,
  overscan = 5,
  prefetchMargin = 400,
  className,
}: VirtualInfiniteListProps<TItem>) {
  // The scroll container is held as state rather than in a ref because two
  // separate consumers need to react to its arrival — the virtualizer and the
  // observer's root — and a ref assignment is not something either can wait
  // for. See `useIntersection` for the failure this avoids.
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);

  // `react-hooks/incompatible-library` reports that `useVirtualizer()` returns
  // functions the React Compiler cannot memoize without risking stale UI, and
  // that it would therefore skip compiling this component. As with
  // `VirtualList`, that diagnostic is correct and is the reason this component
  // is deliberately outside the compiler's opt-in cohort — the project compiles
  // in `annotation` mode, so a component without `"use memo"` is never compiled
  // and the risk cannot arise. Delete this line before annotating it.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (index) => {
      const item = items[index];
      // The virtualizer can ask about an index past the end while a shrink is
      // settling; falling back to the index keeps the key unique either way.
      return item === undefined ? index : getItemKey(item, index);
    },
  });

  const { ref: sentinelRef, isIntersecting } = useIntersection<HTMLDivElement>({
    root: scrollElement,
    rootMargin: `0px 0px ${prefetchMargin}px 0px`,
  });

  const loadMore = useStableCallback(onLoadMore);

  useEffect(() => {
    if (isIntersecting && hasNextPage && !isFetchingNextPage) loadMore();
  }, [isIntersecting, hasNextPage, isFetchingNextPage, loadMore]);

  const status = isFetchingNextPage
    ? "Loading more…"
    : hasNextPage
      ? ""
      : `All ${items.length} items loaded`;

  return (
    <div
      ref={setScrollElement}
      data-testid="virtual-scroll-container"
      className={cn(
        "overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)]",
        className,
      )}
      style={{ height }}
    >
      <div
        role="list"
        aria-label={label}
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          if (item === undefined) return null;
          return (
            <div
              key={virtualRow.key}
              role="listitem"
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {renderItem(item, virtualRow.index)}
            </div>
          );
        })}
      </div>

      {/*
        The tripwire. After the spacer rather than inside it, so its position is
        the end of the scroll range with no arithmetic and no dependence on
        `getTotalSize()` having settled; 1px tall so it contributes nothing to
        that range. Unmounted once there is no next page, which is also what
        tears the observer down.
      */}
      {hasNextPage && (
        <div
          ref={sentinelRef}
          aria-hidden="true"
          data-testid="prefetch-sentinel"
          className="h-px"
        />
      )}

      {/*
        Always rendered, even while it says nothing. A live region has to be in
        the accessibility tree *before* its content changes for the change to be
        announced; mounting the region and its text in the same commit is the
        common way to ship a status nobody ever hears.
      */}
      <div
        role="status"
        data-testid="load-more-status"
        className="flex min-h-9 items-center justify-center px-3 text-xs text-[var(--color-muted-fg)]"
      >
        {status}
      </div>
    </div>
  );
}
