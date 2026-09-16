/**
 * How long to wait before trying a failed request again.
 *
 * The arithmetic lives here, on its own, with no `fetch` and no timers: a
 * schedule is a pure function of the attempt number and one random draw, which
 * is what makes it assertable without advancing a clock. `withRetry` supplies
 * the attempt number and the waiting; this module only says how long.
 */

/** The shape of an exponential schedule. */
export interface BackoffOptions {
  /**
   * Ceiling on the *first* retry's wait, doubled for each attempt after it.
   *
   * It is a ceiling rather than the wait itself — see {@link backoffWithJitterMs}.
   */
  readonly baseDelayMs: number;
  /** Ceiling on the doubling, so attempt 12 does not ask for 17 minutes. */
  readonly maxDelayMs: number;
}

/**
 * 250 ms doubling to 8 s.
 *
 * Chosen for a request a user is waiting on, which is a different problem from
 * the one `shared/offline/syncQueue.ts` solves with a 30 s base: a queued write
 * replays in the background and nobody is watching, so it can afford to be
 * polite. Three retries on this schedule add at most 250 + 500 + 1000 ms to a
 * failing request — under a second of extra latency before the error surfaces,
 * which is the budget that keeps "retry quietly" from meaning "hang".
 */
export const DEFAULT_BACKOFF: BackoffOptions = {
  baseDelayMs: 250,
  maxDelayMs: 8_000,
};

/**
 * Full jitter: a uniform draw from `[0, min(max, base × 2^attempt))`.
 *
 * `attempt` is zero-based — attempt 0 is the wait before the first retry.
 *
 * ### Why the wait is a ceiling and not a value
 *
 * Plain exponential backoff spaces *one* client's retries correctly and does
 * nothing about the problem that actually takes servers down. When a backend
 * sheds load, every client in the fleet fails at the same instant and therefore
 * retries at the same instant, twice more at the same instant, and the recovery
 * window is hit by the same spike that caused the outage. Backoff without
 * jitter preserves that correlation exactly; it just stretches it out.
 *
 * Drawing uniformly from the whole interval — "full jitter", from AWS's
 * *Exponential Backoff and Jitter* — destroys the correlation outright: two
 * clients that failed in the same millisecond come back at two unrelated
 * times. The cost is that some retries land almost immediately, which is the
 * common objection to it, and it is worth being precise about why that is
 * acceptable here: the draw is uniform, so the *expected* wait is still half
 * the exponential ceiling and the aggregate rate across clients still halves
 * per attempt. A single unlucky client retrying after 3 ms is not a load
 * problem; ten thousand clients retrying after exactly 250 ms is.
 *
 * "Equal jitter" (half fixed, half random) is the usual compromise and is a
 * defensible alternative — it trades a little of that decorrelation for a
 * guaranteed floor. It is not what is used, because the floor buys nothing a
 * server cannot get from `Retry-After`, which this client honours.
 *
 * `random` is injected so a test asserts the interval rather than sampling it.
 */
export function backoffWithJitterMs(
  attempt: number,
  options: BackoffOptions = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** attempt);
  return Math.round(random() * ceiling);
}

/**
 * `Retry-After`, in milliseconds from `nowMs`, or `undefined` when absent or
 * unparseable.
 *
 * Both spellings are accepted because both are used: a rate limiter emits
 * delta-seconds, and a maintenance window emits an HTTP date. A date in the
 * past means "now" rather than a negative wait, so the result never goes below
 * zero.
 *
 * Unparseable is `undefined` rather than zero on purpose. A header nobody can
 * read is a header that says nothing, and the caller's own schedule is a better
 * answer than "retry immediately" — which is what a malformed value would mean
 * if it were floored into a number.
 */
export function parseRetryAfterMs(header: string | null, nowMs: number): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (trimmed === "") return undefined;
  const seconds = Number(trimmed);
  // `Number("")` is 0 and `Number(" 1 ")` is 1, so the empty check above has to
  // come first; past it, a finite number is delta-seconds by definition.
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - nowMs);
}
