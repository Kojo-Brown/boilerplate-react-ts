import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/cn";

export interface VirtualListItem {
  id: string;
  label: string;
  description?: string | undefined;
}

export interface VirtualListProps {
  items: VirtualListItem[];
  /** Estimated row height in px used for initial layout (default 48). */
  estimateSize?: number | undefined;
  /** Height of the scrollable container in px (default 400). */
  height?: number | undefined;
  className?: string | undefined;
  /** Optional custom row renderer — receives the item and its 0-based index. */
  renderItem?:
    | ((item: VirtualListItem, index: number) => React.ReactNode)
    | undefined;
}

/**
 * VirtualList renders only the rows visible in the viewport, keeping DOM
 * node count constant regardless of dataset size.
 *
 * Usage:
 *   const items = Array.from({ length: 50_000 }, (_, i) => ({
 *     id: String(i),
 *     label: `Row ${i + 1}`,
 *     description: `Subtitle for row ${i + 1}`,
 *   }));
 *   <VirtualList items={items} height={500} estimateSize={56} />
 */
export function VirtualList({
  items,
  estimateSize = 48,
  height = 400,
  className,
  renderItem,
}: VirtualListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan: 5,
  });

  return (
    <div
      ref={parentRef}
      role="list"
      aria-label="Virtual list"
      className={cn(
        "overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)]",
        className,
      )}
      style={{ height }}
    >
      <div
        style={{ height: virtualizer.getTotalSize() }}
        className="relative w-full"
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          // The virtualizer can briefly report a row whose index is past the
          // end of `items` while a resize is settling.
          if (!item) return null;
          return (
            <div
              key={virtualRow.key}
              role="listitem"
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {renderItem ? (
                renderItem(item, virtualRow.index)
              ) : (
                <DefaultRow item={item} index={virtualRow.index} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface DefaultRowProps {
  item: VirtualListItem;
  index: number;
}

function DefaultRow({ item, index }: DefaultRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2",
        "border-b border-[var(--color-border)]",
      )}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-muted)] text-xs font-medium text-[var(--color-fg)]">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--color-fg)]">
          {item.label}
        </p>
        {item.description && (
          <p className="truncate text-xs text-[var(--color-fg)] opacity-60">
            {item.description}
          </p>
        )}
      </div>
    </div>
  );
}
