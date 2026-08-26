/** Where the slow route's Suspense boundary lives for this run. */
export type BoundaryPlacement = "hoisted" | "per-route";

/** Base latency used when `?latency=` is missing or unusable. */
export const DEFAULT_ROUTE_LATENCY_MS = 1_500;

/** Upper bound on `?latency=`, long enough to click around during a hold. */
export const MAX_ROUTE_LATENCY_MS = 10_000;

/**
 * Anything other than an explicit `per-route` uses the hoisted boundary.
 *
 * The hoisted arm is the app's real configuration, so it is the default: the
 * lab should show what the app does unless asked to show the alternative.
 */
export function parseBoundaryPlacement(raw: string | null): BoundaryPlacement {
  return raw === "per-route" ? "per-route" : "hoisted";
}

/** Parses `?latency=`, falling back to the default and clamping to the maximum. */
export function parseRouteLatency(raw: string | null): number {
  const parsed = Number(raw);
  if (raw === null || raw.trim() === "" || !Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_ROUTE_LATENCY_MS;
  }
  return Math.min(MAX_ROUTE_LATENCY_MS, Math.floor(parsed));
}

/** Parses `?run=`, the counter that makes a repeat visit suspend again. */
export function parseRouteRun(raw: string | null): number {
  const parsed = Number(raw);
  if (raw === null || !Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

/** Builds the href for one run of the slow route. */
export function slowRouteHref(
  placement: BoundaryPlacement,
  latencyMs: number,
  run: number,
): string {
  const params = new URLSearchParams({
    boundary: placement,
    latency: String(latencyMs),
    run: String(run),
  });
  return `/labs/navigation/slow?${params.toString()}`;
}
