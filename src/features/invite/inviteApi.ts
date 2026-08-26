/**
 * The demo domain for the Actions API pattern.
 *
 * Inviting a teammate is small enough to read in one screen and still produces
 * both kinds of failure a form has to handle: one the client can see for itself
 * (a malformed address) and one only the server knows (that address is already
 * on the team). The second is the reason a form needs somewhere to put an error
 * that arrives *after* the request — which is exactly what `useActionState`
 * returns.
 */

export const TEAM_ROLES = ["member", "admin"] as const;

export type TeamRole = (typeof TEAM_ROLES)[number];

/** Human-readable role names, for messages and `<option>` labels. */
export const ROLE_LABELS: Readonly<Record<TeamRole, string>> = {
  member: "Member",
  admin: "Admin",
};

export interface Invite {
  readonly id: string;
  readonly email: string;
  readonly role: TeamRole;
  readonly note: string;
}

export interface InviteInput {
  readonly email: string;
  readonly role: TeamRole;
  readonly note: string;
}

/**
 * A refusal from the fake server.
 *
 * `field` is what makes this worth a class rather than a string: an error the
 * server can attribute to one control (`email` is taken) belongs under that
 * control, and an error it cannot (the service is down) belongs at the top of
 * the form. The action reads `field` to decide which, so the distinction is
 * made once, by the side that actually knows.
 */
export class InviteRejectedError extends Error {
  readonly field: keyof InviteInput | null;

  constructor(message: string, field: keyof InviteInput | null = null) {
    super(message);
    this.name = "InviteRejectedError";
    this.field = field;
  }
}

export interface InviteApi {
  invite(input: InviteInput): Promise<Invite>;
}

export interface InMemoryInviteApiOptions {
  /** Addresses already on the team. Inviting one of them is rejected. */
  readonly existingEmails?: readonly string[] | undefined;
  /** Simulated round-trip time in ms. Defaults to 0 (settles on a microtask). */
  readonly latencyMs?: number | undefined;
  /**
   * Return a message to make the call fail at the form level, or `null` to let
   * it through. A predicate rather than a failure rate, so a demo of the error
   * path is reproducible instead of flaky.
   */
  readonly failWhen?: ((input: InviteInput) => string | null) | undefined;
}

const delay = (ms: number): Promise<void> =>
  ms > 0
    ? new Promise((resolve) => {
        setTimeout(resolve, ms);
      })
    : Promise.resolve();

/** Addresses are compared case-insensitively, the way a real invite list would. */
const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * An in-memory `InviteApi` with deterministic ids and controllable failures.
 *
 * Ids come from a counter (`invite-1`) rather than `crypto.randomUUID()` so a
 * success is assertable without matching a pattern.
 *
 * Usage:
 *   const api = createInMemoryInviteApi({
 *     existingEmails: ["ada@example.com"],
 *     latencyMs: 400,
 *   });
 */
export function createInMemoryInviteApi(options: InMemoryInviteApiOptions = {}): InviteApi {
  const { existingEmails = [], latencyMs = 0, failWhen } = options;

  const invited = new Set(existingEmails.map(normalizeEmail));
  let nextId = 1;

  return {
    async invite(input) {
      await delay(latencyMs);

      const outage = failWhen?.(input);
      if (outage !== null && outage !== undefined) {
        throw new InviteRejectedError(outage);
      }

      const email = normalizeEmail(input.email);
      if (invited.has(email)) {
        throw new InviteRejectedError(`${email} is already on the team.`, "email");
      }

      invited.add(email);
      return {
        id: `invite-${nextId++}`,
        email,
        role: input.role,
        note: input.note.trim(),
      };
    },
  };
}
