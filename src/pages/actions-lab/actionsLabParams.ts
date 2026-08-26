/** Which fake invitation service `/labs/actions` runs against. */
export type InviteServerMode = "healthy" | "failing";

/**
 * Seeded onto the team, so the server-only failure — an address that is already
 * a member — is reachable by typing rather than by inviting someone twice.
 */
export const SEEDED_TEAM_EMAIL = "ada@example.com";

/** Message the failing server rejects every invitation with. */
export const INVITE_OUTAGE_MESSAGE = "The invitation service is unavailable.";

/** Latency used when `?latency=` is missing or unusable. */
export const DEFAULT_INVITE_LATENCY_MS = 600;

/**
 * Upper bound on `?latency=`. Long enough to read the pending state properly,
 * short enough that the page still behaves like a demo rather than a hang.
 */
export const MAX_INVITE_LATENCY_MS = 5_000;

/** Anything other than an explicit `failing` runs against the healthy server. */
export function parseInviteServerMode(raw: string | null): InviteServerMode {
  return raw === "failing" ? "failing" : "healthy";
}

/** Parses `?latency=`, falling back to the default and clamping to the maximum. */
export function parseInviteLatency(raw: string | null): number {
  const parsed = Number(raw);
  if (raw === null || raw.trim() === "" || !Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_INVITE_LATENCY_MS;
  }
  return Math.min(MAX_INVITE_LATENCY_MS, Math.floor(parsed));
}
