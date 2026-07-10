import { memo, useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/cn";

export interface ListItem {
  id: string;
  label: string;
  meta?: string;
}

interface RowProps {
  item: ListItem;
  isSelected: boolean;
  onToggle: (id: string) => void;
}

// React.memo with a custom comparator — re-renders only when props change by value.
const Row = memo(
  function Row({ item, isSelected, onToggle }: RowProps) {
    return (
      <li
        role="option"
        aria-selected={isSelected}
        onClick={() => onToggle(item.id)}
        className={cn(
          "flex cursor-pointer items-center justify-between px-3 py-2",
          "rounded-[var(--radius-md)] transition-colors",
          "hover:bg-[var(--color-muted)]",
          isSelected &&
            "bg-[var(--color-primary)] text-[var(--color-primary-fg)] hover:bg-[var(--color-primary)]",
        )}
      >
        <span className="font-medium">{item.label}</span>
        {item.meta && (
          <span className={cn("text-xs opacity-60", isSelected && "opacity-80")}>
            {item.meta}
          </span>
        )}
      </li>
    );
  },
  (prev, next) =>
    prev.item === next.item &&
    prev.isSelected === next.isSelected &&
    prev.onToggle === next.onToggle,
);

export interface MemoizedListProps {
  items: ListItem[];
  initialSelectedIds?: string[];
  onSelectionChange?: (selectedIds: string[]) => void;
}

export function MemoizedList({
  items,
  initialSelectedIds = [],
  onSelectionChange,
}: MemoizedListProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialSelectedIds),
  );

  // useCallback keeps onToggle referentially stable so memo'd Row components
  // skip re-renders when unrelated parent state changes.
  const onToggle = useCallback(
    (id: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        onSelectionChange?.([...next]);
        return next;
      });
    },
    [onSelectionChange],
  );

  // useMemo avoids re-sorting on every render when only selection state changes.
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.label.localeCompare(b.label)),
    [items],
  );

  if (!sortedItems.length) {
    return (
      <p className="px-3 py-4 text-sm text-[var(--color-fg)]">
        No items.
      </p>
    );
  }

  return (
    <ul role="listbox" aria-multiselectable className="flex flex-col gap-1 p-1">
      {sortedItems.map((item) => (
        <Row
          key={item.id}
          item={item}
          isSelected={selectedIds.has(item.id)}
          onToggle={onToggle}
        />
      ))}
    </ul>
  );
}
