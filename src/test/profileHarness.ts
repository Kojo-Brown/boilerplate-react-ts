import { ProfileApiError, type ProfileApi, type UserProfile } from "@/entities/user/profileApi";

export interface DeferredProfileApi extends ProfileApi {
  /** Resolves the in-flight request for `id`. */
  resolve(id: string, profile: UserProfile): Promise<void>;
  /** Rejects the in-flight request for `id`. */
  reject(id: string, message?: string): Promise<void>;
  /** Ids that have been requested, in the order they were requested. */
  requested(): readonly string[];
}

/**
 * A {@link ProfileApi} whose requests settle only when the test says so.
 *
 * `createInMemoryProfileApi({ latencyMs })` is right for the browser and wrong
 * for asserting on a fallback. "The skeleton is up" is a claim about the
 * window between the request starting and settling, and holding that window
 * open with a timer is a race against however loaded the machine is — the
 * initial render has to finish inside it, and on a busy CI runner it does not.
 * That is a real failure this suite hit rather than a hypothetical one.
 *
 * With a gate there is no window to lose: nothing settles until `resolve` is
 * called, so the assertion can take as long as it likes. It also removes the
 * sleep, so the tests are faster as well as deterministic.
 *
 * Settling has to be awaited inside an act scope, since it is what pushes a
 * boundary out of its fallback:
 *
 *   await actAsync(() => api.resolve("u-1", profile));
 *
 * See `reportHarness.ts` for the same shape over the report sections.
 */
export function createDeferredProfileApi(): DeferredProfileApi {
  const ids: string[] = [];
  const gates = new Map<
    string,
    { settle: (profile: UserProfile) => void; fail: (error: Error) => void }
  >();

  function gateFor(id: string) {
    const gate = gates.get(id);
    if (gate === undefined) {
      throw new Error(
        `Profile "${id}" has not been requested, so there is nothing to settle. ` +
          `Requested so far: ${ids.join(", ")}.`,
      );
    }
    gates.delete(id);
    return gate;
  }

  return {
    fetchProfile(id) {
      ids.push(id);
      return new Promise<UserProfile>((settle, fail) => {
        gates.set(id, { settle, fail });
      });
    },

    requestCount: () => ids.length,
    requested: () => [...ids],

    async resolve(id, profile) {
      gateFor(id).settle(profile);
      // The suspended component re-renders on a microtask once the promise it
      // is waiting on settles; yielding here means the caller's act scope
      // covers that work rather than closing before it happens.
      await Promise.resolve();
    },

    async reject(id, message = "Profile service unavailable") {
      gateFor(id).fail(new ProfileApiError(message));
      await Promise.resolve();
    },
  };
}
