/**
 * The demo domain for the `use()` pattern.
 *
 * A profile is a single record fetched by id, which is the shape `use()` fits
 * best: one component, one await, one Suspense boundary. Lists and pagination
 * would drag in cache invalidation questions that belong to TanStack Query
 * rather than to `use()`.
 */
export interface UserProfile {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: "admin" | "user";
  readonly joinedAt: string;
}

/** The read surface `<UserProfileCard>` depends on, via the promise cache. */
export interface ProfileApi {
  fetchProfile(id: string): Promise<UserProfile>;
  /**
   * How many requests actually went out.
   *
   * The whole value of the cache is that a re-render does not re-request, and
   * a claim like that is worth asserting rather than asserting around.
   */
  requestCount(): number;
}

/** Thrown by the in-memory API for a missing profile or an induced failure. */
export class ProfileApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileApiError";
  }
}

export interface InMemoryProfileApiOptions {
  readonly profiles?: readonly UserProfile[] | undefined;
  /** Simulated round-trip time in ms. Defaults to 0 (settles on a macrotask). */
  readonly latencyMs?: number | undefined;
  /**
   * Return a message to make that id fail, or `null` to let it through.
   * A predicate rather than a failure rate, so a rollback or retry test is
   * deterministic — a flaky fake server makes a flaky test.
   */
  readonly failWhen?: ((id: string) => string | null) | undefined;
}

/** Two profiles: enough for "one card succeeded while its sibling failed". */
export const DEMO_PROFILES: readonly UserProfile[] = [
  {
    id: "u-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    role: "admin",
    joinedAt: "2024-03-11",
  },
  {
    id: "u-2",
    name: "Grace Hopper",
    email: "grace@example.com",
    role: "user",
    joinedAt: "2024-07-02",
  },
];

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * An in-memory {@link ProfileApi} with controllable latency and failures.
 *
 * Note that even at `latencyMs: 0` this resolves on a timer rather than
 * synchronously. That is deliberate: a promise that is already resolved by the
 * time `use()` sees it never suspends, so a "zero latency" API built on
 * `Promise.resolve()` would quietly stop exercising the Suspense path the tests
 * exist to cover.
 *
 * Usage:
 *   const api = createInMemoryProfileApi({
 *     latencyMs: 400,
 *     failWhen: (id) => (id === "u-2" ? "Profile service unavailable" : null),
 *   });
 */
export function createInMemoryProfileApi(options: InMemoryProfileApiOptions = {}): ProfileApi {
  const { profiles = DEMO_PROFILES, latencyMs = 0, failWhen } = options;

  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  let requests = 0;

  return {
    async fetchProfile(id) {
      requests += 1;
      await delay(latencyMs);

      const failure = failWhen?.(id);
      if (failure !== null && failure !== undefined) throw new ProfileApiError(failure);

      const profile = byId.get(id);
      if (profile === undefined) throw new ProfileApiError(`No profile with id ${id}`);
      return profile;
    },

    requestCount() {
      return requests;
    },
  };
}
