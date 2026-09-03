/**
 * Whether the user has asked not to have bytes spent on their behalf.
 *
 * Speculative loading is the first thing that should stop when they have: a
 * prefetch is a bet placed with someone else's data allowance, and on a
 * metered connection the bet is one they did not agree to. Two signals, both
 * advisory and both worth honouring:
 *
 * - `navigator.connection.saveData` — the Save-Data preference, set by the
 *   browser's data-saver mode. An explicit request.
 * - `navigator.connection.effectiveType` — the round-trip and throughput of
 *   the connection expressed as a cellular generation. On `2g` or `slow-2g` a
 *   prefetch does not merely cost bytes, it takes bandwidth away from the
 *   request the user is actually waiting on.
 *
 * Neither is in `lib.dom`: the Network Information API is a draft, is absent
 * from Safari and Firefox entirely, and the shape here is what Chromium
 * exposes. Absent means *no preference expressed*, so the answer is `false` —
 * defaulting to "reduce" would silently disable prefetching in two of the
 * three engines, which looks exactly like the feature not working.
 */

/** The Network Information fields read here. Everything is optional. */
export interface ConnectionLike {
  readonly saveData?: unknown;
  readonly effectiveType?: unknown;
}

/**
 * Connection classes too slow to spend on a guess.
 *
 * `3g` is deliberately absent. It is the modal connection in much of the
 * world, and excluding it would turn prefetching into a feature only fast
 * networks get — which is backwards, since a slow-but-adequate link is where
 * having the chunk early helps most.
 */
const TOO_SLOW: readonly string[] = ["slow-2g", "2g"];

export function readConnection(nav: Navigator): ConnectionLike | null {
  const connection: unknown = Reflect.get(nav, "connection");
  if (typeof connection !== "object" || connection === null) return null;
  return connection;
}

export function prefersReducedData(nav: Navigator = navigator): boolean {
  const connection = readConnection(nav);
  if (connection === null) return false;
  if (connection.saveData === true) return true;
  return (
    typeof connection.effectiveType === "string" && TOO_SLOW.includes(connection.effectiveType)
  );
}
