export type SortDir = "asc" | "desc";

/**
 * Derives a filtered and sorted list from `items`.
 *
 * Opted into the React Compiler (see `docs/react-compiler.md`). The `useMemo`
 * this hook used to wrap its body in is gone: the compiler infers the same
 * dependency set from the code itself, so the memoization is still there, it
 * is just no longer hand-maintained. That removes the failure mode the manual
 * version had — a dependency array that drifts out of sync with the body and
 * silently serves stale results.
 *
 * `useFilteredSortedItems.test.ts` asserts the referential stability that the
 * `useMemo` used to provide, so this is a checked claim rather than a hopeful
 * one.
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
  "use memo";

  const lower = query.trim().toLowerCase();
  const filtered = lower
    ? items.filter((item) => String(item[searchKey]).toLowerCase().includes(lower))
    : [...items];

  return filtered.sort((a, b) => {
    const cmp = String(a[sortKey]).localeCompare(String(b[sortKey]));
    return sortDir === "asc" ? cmp : -cmp;
  });
}
