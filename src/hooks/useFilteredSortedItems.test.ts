import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFilteredSortedItems } from "./useFilteredSortedItems";

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
    const { result } = renderHook(() =>
      useFilteredSortedItems(ITEMS, "", "name", "name", "asc"),
    );
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
    const { result } = renderHook(() =>
      useFilteredSortedItems(ITEMS, "", "name", "name", "desc"),
    );
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
      ({ query }: { query: string }) =>
        useFilteredSortedItems(ITEMS, query, "name", "name", "asc"),
      { initialProps: { query: "" } },
    );
    expect(result.current).toHaveLength(3);

    rerender({ query: "bob" });
    expect(result.current).toHaveLength(1);
    expect(result.current[0]?.name).toBe("Bob");
  });

  it("does not mutate the original array order", () => {
    renderHook(() =>
      useFilteredSortedItems(ITEMS, "", "name", "name", "asc"),
    );
    expect(ITEMS.map((i) => i.name)).toEqual(["Charlie", "Alice", "Bob"]);
  });
});
