/**
 * Whether an access token's expiry has passed.
 *
 * All that survives of `persistedSession.ts`, which used to read a session back
 * out of `localStorage`. The reading is gone; the arithmetic is still needed,
 * because `expiresAt` is an absolute wall-clock millisecond and every caller
 * that compares it to `Date.now()` by hand gets to pick its own off-by-one.
 *
 * Expressed as `>=` rather than `>`: a token whose expiry is exactly now is
 * expired. The server will reject it, so treating the boundary as still-valid
 * only moves the failure from a comparison the client controls to a 401 it
 * does not.
 */
export function isSessionExpired(expiresAt: number): boolean {
  return Date.now() >= expiresAt;
}
