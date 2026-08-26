import { describe, it, expect } from "vitest";
import {
  createFilterableItems,
  filterItems,
  ITEM_CATEGORIES,
  type FilterableItem,
} from "@/shared/lib/filterableItems";

describe("createFilterableItems", () => {
  it("creates the requested number of rows", () => {
    expect(createFilterableItems(250)).toHaveLength(250);
  });

  it("returns an empty array for zero or negative counts", () => {
    expect(createFilterableItems(0)).toEqual([]);
    expect(createFilterableItems(-10)).toEqual([]);
  });

  it("assigns unique ids", () => {
    const items = createFilterableItems(500);
    expect(new Set(items.map((item) => item.id)).size).toBe(500);
  });

  it("is deterministic for a given seed", () => {
    expect(createFilterableItems(100, 7)).toEqual(createFilterableItems(100, 7));
  });

  it("produces different data for different seeds", () => {
    const a = createFilterableItems(100, 1);
    const b = createFilterableItems(100, 2);
    expect(a).not.toEqual(b);
  });

  it("only uses known categories", () => {
    const categories = new Set(createFilterableItems(500).map((item) => item.category));
    for (const category of categories) {
      expect(ITEM_CATEGORIES).toContain(category);
    }
  });

  it("scores every row within 0–1000", () => {
    for (const item of createFilterableItems(300)) {
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(1000);
    }
  });

  it("spreads rows across more than one category", () => {
    const categories = new Set(createFilterableItems(500).map((item) => item.category));
    expect(categories.size).toBeGreaterThan(1);
  });
});

const items: FilterableItem[] = [
  { id: "1", name: "Deferred Queue 1", category: "Analytics", score: 10 },
  { id: "2", name: "Elastic Ledger 2", category: "Billing", score: 20 },
  { id: "3", name: "deferred Snapshot 3", category: "Billing", score: 30 },
];

describe("filterItems", () => {
  it("returns everything for an empty query and no category", () => {
    expect(filterItems(items, "")).toHaveLength(3);
  });

  it("matches names case-insensitively", () => {
    expect(filterItems(items, "DEFERRED").map((item) => item.id)).toEqual(["1", "3"]);
  });

  it("matches on a substring anywhere in the name", () => {
    expect(filterItems(items, "ledger").map((item) => item.id)).toEqual(["2"]);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect(filterItems(items, "   elastic  ").map((item) => item.id)).toEqual(["2"]);
  });

  it("treats a whitespace-only query as empty", () => {
    expect(filterItems(items, "   ")).toHaveLength(3);
  });

  it("narrows to a single category", () => {
    expect(filterItems(items, "", "Billing").map((item) => item.id)).toEqual(["2", "3"]);
  });

  it("applies query and category together", () => {
    expect(filterItems(items, "deferred", "Billing").map((item) => item.id)).toEqual(["3"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterItems(items, "nonexistent")).toEqual([]);
  });

  it("does not mutate the input", () => {
    const snapshot = structuredClone(items);
    filterItems(items, "deferred", "Billing");
    expect(items).toEqual(snapshot);
  });
});
