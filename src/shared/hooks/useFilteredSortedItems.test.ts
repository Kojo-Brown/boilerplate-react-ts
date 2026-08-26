import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFilteredSortedItems, type SortDir } from "@/shared/hooks/useFilteredSortedItems";

interface Item {
  id: string;
  name: string;
  age: number;
}

const ITEMS: readonly Item[] = [
  { id: "1", name: "Charlie", age: 30 },
  { id: "2", name: "Alice", age: 25 },
  { id: "3", name: "Bob", age: 35 },
];

describe("useFilteredSortedItems", () => {
  it("returns all items sorted asc when query is empty", () => {
    const { result } = renderHook(() => useFilteredSortedItems(ITEMS, "", "name", "name", "asc"));
    expect(result.current.map((i) => i.name)).toEqual(["Alice", "Bob", "Charlie"]);
  });

  it("filters items by query case-insensitively", () => {
    const { result } = renderHook(() =>
      useFilteredSortedItems(ITEMS, "ali", "name", "name", "asc"),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0]?.name).toBe("Alice");
  });

  it("sorts descending when sortDir is desc", () => {
    const { result } = renderHook(() => useFilteredSortedItems(ITEMS, "", "name", "name", "desc"));
    expect(result.current.map((i) => i.name)).toEqual(["Charlie", "Bob", "Alice"]);
  });

  it("returns empty array when no items match filter", () => {
    const { result } = renderHook(() =>
      useFilteredSortedItems(ITEMS, "xyz", "name", "name", "asc"),
    );
    expect(result.current).toHaveLength(0);
  });

  it("recomputes when query changes", () => {
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useFilteredSortedItems(ITEMS, query, "name", "name", "asc"),
      { initialProps: { query: "" } },
    );
    expect(result.current).toHaveLength(3);

    rerender({ query: "bob" });
    expect(result.current).toHaveLength(1);
    expect(result.current[0]?.name).toBe("Bob");
  });

  it("does not mutate the original array order", () => {
    renderHook(() => useFilteredSortedItems(ITEMS, "", "name", "name", "asc"));
    expect(ITEMS.map((i) => i.name)).toEqual(["Charlie", "Alice", "Bob"]);
  });

  // This hook's `useMemo` was removed when it opted into the React Compiler.
  // These two tests are what makes that a safe trade rather than an assumption:
  // they assert the memoization still exists and still invalidates correctly.
  // They only mean anything because `vitest.config.ts` runs the suite through
  // the compiler — against uncompiled source the first one fails.
  it("returns a referentially stable result when inputs are unchanged", () => {
    const { result, rerender } = renderHook(() =>
      useFilteredSortedItems(ITEMS, "", "name", "name", "asc"),
    );
    const first = result.current;

    rerender();
    rerender();

    expect(result.current).toBe(first);
  });

  it("returns a new reference when an input changes", () => {
    const { result, rerender } = renderHook(
      ({ dir }: { dir: SortDir }) => useFilteredSortedItems(ITEMS, "", "name", "name", dir),
      { initialProps: { dir: "asc" as SortDir } },
    );
    const asc = result.current;

    rerender({ dir: "desc" });

    expect(result.current).not.toBe(asc);
    expect(result.current.map((i) => i.name)).toEqual(["Charlie", "Bob", "Alice"]);
  });
});
