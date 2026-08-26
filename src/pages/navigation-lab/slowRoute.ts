import { createPromiseCache, type PromiseCache } from "@/shared/lib/promiseCache";

/**
 * The artificial chunk download behind `/labs/navigation/slow`.
 *
 * A real `React.lazy` route cannot demonstrate this more than once: the module
 * promise settles, and a settled promise never suspends again, so the second
 * visit is instant and the lab has nothing to show. Suspending on a *keyed*
 * promise instead makes each run a new key and therefore a new suspension,
 * which is the same reason the streaming lab remounts on a key.
 */
export type SlowRouteCache = PromiseCache<string, null>;

/** Identifies one run: a fresh key suspends again, the same key does not. */
export function slowRouteKey(latencyMs: number, run: number): string {
  return `${String(latencyMs)}:${String(run)}`;
}

/**
 * The latency a key asks for.
 *
 * The key carries it rather than the cache closing over it, so changing the
 * latency control is itself a new run — a cache built around one delay would
 * keep replaying that delay under a key that claims a different one.
 */
export function slowRouteLatency(key: string): number {
  const [raw] = key.split(":");
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function timerSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Builds the cache the slow route suspends on.
 *
 * `sleep` is injected so tests can settle a run on command instead of waiting:
 * a latency-driven test asserts on whichever ordering the machine happened to
 * produce, which is how the streaming lab's first draft failed.
 */
export function createSlowRouteCache(
  sleep: (ms: number) => Promise<void> = timerSleep,
): SlowRouteCache {
  // Resolves to `null` rather than `void`: `void` as a type *argument* on a
  // call expression trips `no-invalid-void-type`, the same misfire the RTK
  // Query endpoints hit. The value is never read either way.
  return createPromiseCache<string, null>({
    load: (key) => sleep(slowRouteLatency(key)).then(() => null),
  });
}
