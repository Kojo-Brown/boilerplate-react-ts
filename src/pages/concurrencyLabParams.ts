import type { SchedulingMode } from "@/components/performance/ConcurrentFilterList";

/** Rows generated when `?n=` is missing or unusable. */
export const DEFAULT_ITEM_COUNT = 15_000;

/**
 * Upper bound on `?n=`. Past this the page stops being a demonstration and
 * starts being a way to hang the tab.
 */
export const MAX_ITEM_COUNT = 50_000;

/** Anything other than an explicit `blocking` runs the shipped configuration. */
export function parseMode(raw: string | null): SchedulingMode {
  return raw === "blocking" ? "blocking" : "concurrent";
}

/** Parses `?n=`, falling back to the default and clamping to the maximum. */
export function parseItemCount(raw: string | null): number {
  const parsed = Number(raw);
  if (raw === null || raw.trim() === "" || !Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_ITEM_COUNT;
  }
  return Math.min(MAX_ITEM_COUNT, Math.floor(parsed));
}
