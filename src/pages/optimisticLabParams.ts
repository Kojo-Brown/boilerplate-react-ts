/** Which fake server `/labs/optimistic` runs against. */
export type ServerMode = "healthy" | "failing";

/** Latency used when `?latency=` is missing or unusable. */
export const DEFAULT_LATENCY_MS = 400;

/**
 * Upper bound on `?latency=`. Long enough to watch a provisional row sit there,
 * short enough that the page still feels like a demo rather than a hang.
 */
export const MAX_LATENCY_MS = 5_000;

/** Anything other than an explicit `failing` runs against the healthy server. */
export function parseServerMode(raw: string | null): ServerMode {
  return raw === "failing" ? "failing" : "healthy";
}

/** Parses `?latency=`, falling back to the default and clamping to the maximum. */
export function parseLatency(raw: string | null): number {
  const parsed = Number(raw);
  if (raw === null || raw.trim() === "" || !Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_LATENCY_MS;
  }
  return Math.min(MAX_LATENCY_MS, Math.floor(parsed));
}
