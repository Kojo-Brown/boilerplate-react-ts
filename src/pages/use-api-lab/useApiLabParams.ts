/** Which fake profile service `/labs/use` runs against. */
export type ProfileServerMode = "healthy" | "failing";

/** The id the failing server rejects, so one panel errors while its sibling renders. */
export const FAILING_PROFILE_ID = "u-2";

/** Message the failing server rejects with. */
export const PROFILE_FAILURE_MESSAGE = "The profile service is unavailable.";

/** Latency used when `?latency=` is missing or unusable. */
export const DEFAULT_PROFILE_LATENCY_MS = 600;

/**
 * Upper bound on `?latency=`. Long enough to read the fallback properly, short
 * enough that the page still behaves like a demo rather than a hang.
 */
export const MAX_PROFILE_LATENCY_MS = 5_000;

/** Anything other than an explicit `failing` runs against the healthy server. */
export function parseProfileServerMode(raw: string | null): ProfileServerMode {
  return raw === "failing" ? "failing" : "healthy";
}

/** Parses `?latency=`, falling back to the default and clamping to the maximum. */
export function parseProfileLatency(raw: string | null): number {
  const parsed = Number(raw);
  if (raw === null || raw.trim() === "" || !Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_PROFILE_LATENCY_MS;
  }
  return Math.min(MAX_PROFILE_LATENCY_MS, Math.floor(parsed));
}
