/**
 * Deterministic dataset used by the concurrency demo and its benchmark.
 *
 * The generator is seeded so a run is reproducible: the same seed and count
 * always produce the same rows, which is what makes a before/after benchmark
 * comparable across modes and machines.
 */

export const ITEM_CATEGORIES = [
  "Analytics",
  "Billing",
  "Identity",
  "Messaging",
  "Storage",
] as const;

export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

/** `"All"` is the unset state of the category filter, not a real category. */
export type CategoryFilter = ItemCategory | "All";

export interface FilterableItem {
  id: string;
  name: string;
  category: ItemCategory;
  score: number;
}

const ADJECTIVES = [
  "Ambient",
  "Backlogged",
  "Cascading",
  "Deferred",
  "Elastic",
  "Federated",
  "Granular",
  "Hydrated",
  "Idempotent",
  "Jittered",
  "Keyed",
  "Layered",
] as const;

const NOUNS = [
  "Queue",
  "Ledger",
  "Session",
  "Digest",
  "Snapshot",
  "Webhook",
  "Bucket",
  "Token",
  "Stream",
  "Index",
] as const;

/**
 * mulberry32 — a small, fast, well-distributed PRNG. Seeded explicitly so the
 * dataset never depends on `Math.random()`.
 */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(values: readonly T[], random: () => number): T {
  // `values` is always a non-empty literal tuple, so the index is in range.
  return values[Math.floor(random() * values.length)] as T;
}

/**
 * Builds `count` rows of realistic-looking filter fodder.
 *
 * Usage:
 *   const items = createFilterableItems(15_000);
 */
export function createFilterableItems(count: number, seed = 1): FilterableItem[] {
  const random = createRng(seed);
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({
    id: `item-${index}`,
    name: `${pick(ADJECTIVES, random)} ${pick(NOUNS, random)} ${index + 1}`,
    category: pick(ITEM_CATEGORIES, random),
    score: Math.round(random() * 1000),
  }));
}

/**
 * Filters by a case-insensitive name substring and an optional category.
 * Pure and synchronous — the cost here is intentionally real, since the whole
 * point of the demo is scheduling an expensive render, not making it cheap.
 */
export function filterItems(
  items: readonly FilterableItem[],
  query: string,
  category: CategoryFilter = "All",
): FilterableItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (category !== "All" && item.category !== category) return false;
    if (!needle) return true;
    return item.name.toLowerCase().includes(needle);
  });
}
