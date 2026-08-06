import { memo, useDeferredValue, useId, useMemo, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import {
  filterItems,
  ITEM_CATEGORIES,
  type CategoryFilter,
  type FilterableItem,
} from "@/lib/filterableItems";

/**
 * Which scheduler the list runs under.
 *
 * - `concurrent` — the keystroke is urgent, the list is deferred. React commits
 *   the input immediately and renders the (large) list at a lower priority,
 *   throwing that render away if another keystroke lands first.
 * - `blocking` — the list reads the urgent value directly. Every keystroke
 *   blocks the frame until the whole list has re-rendered. This is the
 *   "before" picture the benchmark measures against; it is not a mode you
 *   would ship.
 */
export type SchedulingMode = "concurrent" | "blocking";

const CATEGORY_OPTIONS: readonly CategoryFilter[] = ["All", ...ITEM_CATEGORIES];

interface RowProps {
  item: FilterableItem;
}

// The list is deliberately not virtualised: this pattern is about *when* the
// work is scheduled, not about doing less of it. In a real screen, combine it
// with `<VirtualList>`.
const Row = memo(function Row({ item }: RowProps) {
  return (
    <li
      data-testid="filter-row"
      className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-3 py-2 last:border-b-0"
    >
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-fg)]">
        {item.name}
      </span>
      <span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-muted)] px-2 py-0.5 text-xs text-[var(--color-fg)]">
        {item.category}
      </span>
      <span className="w-12 shrink-0 text-right text-xs text-[var(--color-fg)] tabular-nums opacity-60">
        {item.score}
      </span>
    </li>
  );
});

interface ResultRowsProps {
  items: readonly FilterableItem[];
}

/**
 * The expensive subtree, isolated behind `memo`.
 *
 * This is the piece that makes deferring worth anything. Without it, an urgent
 * keystroke re-render still rebuilds 15,000 child elements and React still has
 * to reconcile them — the deferred value would change *what* is rendered but
 * not how much work the keystroke costs. Because `items` is referentially
 * stable until the deferred query catches up, `memo` lets React skip this
 * subtree entirely while the user is still typing.
 */
const ResultRows = memo(function ResultRows({ items }: ResultRowsProps) {
  if (items.length === 0) {
    return (
      <li className="px-3 py-4 text-sm text-[var(--color-fg)] opacity-70">
        No items match this filter.
      </li>
    );
  }
  return items.map((item) => <Row key={item.id} item={item} />);
});

export interface ConcurrentFilterListProps {
  items: readonly FilterableItem[];
  /** Defaults to `concurrent`. */
  mode?: SchedulingMode | undefined;
  className?: string | undefined;
  /** Height of the scroll container in px (default 420). */
  height?: number | undefined;
}

/**
 * A filterable list large enough that re-rendering it costs more than one
 * frame, wired up so the input never waits for that render.
 *
 * Two hooks do the work:
 *
 * - `useDeferredValue(query)` splits one piece of state into an urgent copy
 *   (what the input shows) and a lagging copy (what the list renders from).
 *   While they disagree the list is stale, which the UI says out loud rather
 *   than hiding.
 * - `useTransition()` marks the category change as interruptible and hands
 *   back `isPending`, so the old results stay on screen and interactive
 *   instead of being replaced by a spinner.
 *
 * `<ResultRows>` above is the third, easily-missed half of the pattern: without
 * a memo boundary the urgent render still reconciles every row and deferring
 * buys almost nothing. See the benchmark in the README.
 *
 * Usage:
 *   const items = useMemo(() => createFilterableItems(15_000), []);
 *   <ConcurrentFilterList items={items} />
 */
export function ConcurrentFilterList({
  items,
  mode = "concurrent",
  className,
  height = 420,
}: ConcurrentFilterListProps) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("All");
  const [isPending, startTransition] = useTransition();

  const deferredQuery = useDeferredValue(query);
  // Hooks cannot be called conditionally, so both values always exist and the
  // mode picks which one drives the list.
  const renderedQuery = mode === "concurrent" ? deferredQuery : query;
  const isStale = renderedQuery !== query;

  const visibleItems = useMemo(
    () => filterItems(items, renderedQuery, category),
    [items, renderedQuery, category],
  );

  const selectCategory = (next: CategoryFilter): void => {
    if (mode === "concurrent") {
      startTransition(() => {
        setCategory(next);
      });
      return;
    }
    setCategory(next);
  };

  const isBusy = isPending || isStale;

  return (
    <section
      className={cn("flex flex-col gap-3", className)}
      data-testid="concurrent-filter-list"
      data-mode={mode}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-sm font-medium text-[var(--color-fg)]">
          Filter items
        </label>
        <input
          id={inputId}
          type="search"
          value={query}
          placeholder="Type to filter…"
          autoComplete="off"
          data-testid="filter-input"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className={cn(
            "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2",
            "bg-[var(--color-bg)] text-[var(--color-fg)]",
            "focus:ring-2 focus:ring-[var(--color-primary)] focus:outline-none",
          )}
        />
      </div>

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filter by category"
      >
        {CATEGORY_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={category === option}
            onClick={() => {
              selectCategory(option);
            }}
            className={cn(
              "rounded-[var(--radius-sm)] px-2.5 py-1 text-xs font-medium transition-colors",
              category === option
                ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
                : "bg-[var(--color-muted)] text-[var(--color-fg)] hover:opacity-80",
            )}
          >
            {option}
          </button>
        ))}
      </div>

      <p className="flex items-center gap-2 text-sm text-[var(--color-fg)] opacity-70">
        <span data-testid="result-count">
          {visibleItems.length} of {items.length} matches
        </span>
        <span aria-live="polite" data-testid="busy-label" className="text-xs">
          {isBusy ? "Updating results…" : ""}
        </span>
      </p>

      <ul
        role="list"
        aria-label="Filtered items"
        aria-busy={isBusy}
        data-testid="filter-results"
        data-stale={isStale}
        data-pending={isPending}
        // Dimming the stale list is the honest signal: the rows on screen no
        // longer match what was typed, and they are about to be replaced.
        className={cn(
          "overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)]",
          "transition-opacity duration-150",
          isBusy && "opacity-60",
        )}
        style={{ height }}
      >
        <ResultRows items={visibleItems} />
      </ul>
    </section>
  );
}
