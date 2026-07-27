import { useMemo } from "react";

export type SortDir = "asc" | "desc";

/**
 * Derives a filtered and sorted list from `items` using useMemo.
 * Only re-computes when items, query, searchKey, sortKey, or sortDir change.
 */
// Constrained to `object` rather than `Record<string, unknown>`: interfaces
// have no implicit index signature, so they never satisfy Record<...> and every
// caller passing an interface would fail to compile. Indexing is still safe
// because the keys are constrained to `keyof T`.
export function useFilteredSortedItems<T extends object>(
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
