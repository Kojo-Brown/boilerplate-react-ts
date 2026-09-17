/** Which write verb the fake server rejects. `none` accepts everything. */
export type FailingCall = "none" | "create" | "setDone" | "remove";

const FAILING_CALLS: readonly FailingCall[] = ["none", "create", "setDone", "remove"];

/** Latency used when `?latency=` is missing or unusable. */
export const DEFAULT_LATENCY_MS = 600;

/**
 * Upper bound on `?latency=`.
 *
 * Higher than the `useOptimistic` lab's, because the thing worth watching here
 * takes two mutations: you need long enough to start a second change before the
 * first one comes back, and see that its rollback leaves the second alone.
 */
export const MAX_LATENCY_MS = 8_000;

/** Anything unrecognised means a healthy server. */
export function parseFailingCall(raw: string | null): FailingCall {
  return FAILING_CALLS.find((call) => call === raw) ?? "none";
}

/** Parses `?latency=`, falling back to the default and clamping to the maximum. */
export function parseLatency(raw: string | null): number {
  const parsed = Number(raw);
  if (raw === null || raw.trim() === "" || !Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_LATENCY_MS;
  }
  return Math.min(MAX_LATENCY_MS, Math.floor(parsed));
}
