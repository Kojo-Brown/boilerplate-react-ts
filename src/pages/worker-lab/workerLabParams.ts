/**
 * URL parameters for the worker lab.
 *
 * Row count and arm live in the query string (`?rows=200000&mode=main`) rather
 * than in component state, for the same reason they do in the concurrency lab:
 * a run is then shareable, and the Playwright benchmark can drive both arms of
 * the comparison without a single test-only prop or hook in the component.
 */

/** Selectable sample sizes. 200k is where the blocking arm becomes unusable. */
export const ROW_COUNT_OPTIONS = [10_000, 50_000, 200_000] as const;

export type RowCount = (typeof ROW_COUNT_OPTIONS)[number];

export const DEFAULT_ROW_COUNT: RowCount = 50_000;

/** Which thread does the parsing. */
export const PARSE_MODES = ["worker", "main"] as const;

export type ParseMode = (typeof PARSE_MODES)[number];

export const DEFAULT_PARSE_MODE: ParseMode = "worker";

/** Fixed seed, so every run of the lab parses byte-identical input. */
export const SAMPLE_SEED = 7;

/** One malformed row in every 500, so the error path is visible on every run. */
export const SAMPLE_INVALID_EVERY = 500;

export function parseRowCount(raw: string | null): RowCount {
  const value = Number(raw);
  return ROW_COUNT_OPTIONS.find((option) => option === value) ?? DEFAULT_ROW_COUNT;
}

export function parseParseMode(raw: string | null): ParseMode {
  return PARSE_MODES.find((mode) => mode === raw) ?? DEFAULT_PARSE_MODE;
}

/** Formats a byte count for display. Binary units, one decimal place. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}
