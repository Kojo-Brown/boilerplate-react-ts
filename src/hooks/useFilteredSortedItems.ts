import { useMemo } from "react";

export type SortDir = "asc" | "desc";

/**
 * Derives a filtered and sorted list from `items` using useMemo.
 * Only re-computes when items, query, searchKey, sortKey, or sortDir change.
 */
export function useFilteredSortedItems<T extends Record<string, unknown>>(
  items: readonly T[],
  query: string,
  searchKey: keyof T,
  sortKey: keyof T,
  sortDir: SortDir,
): T[] {
  return useMemo(() => {
    const lower = query.trim().toLowerCase();
    const filtered = lower
      ? items.filter((item) =>
          String(item[searchKey]).toLowerCase().includes(lower),
        )
      : [...items];

    return filtered.sort((a, b) => {
      const cmp = String(a[sortKey]).localeCompare(String(b[sortKey]));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [items, query, searchKey, sortKey, sortDir]);
}
