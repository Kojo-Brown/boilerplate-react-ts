/**
 * A keyed store of in-flight and settled promises, stable across renders.
 *
 * `use(promise)` is only usable with a cache like this one. React re-renders a
 * suspended component every time its boundary retries, so a promise created
 * *during* render is a different promise each pass: the component suspends on
 * it, React retries, render creates another one, and the fallback never leaves.
 * The cache is what makes `read(key)` return the same promise object on every
 * render for the same key, which is the entire precondition for `use()`.
 *
 * Rendering must therefore never call `load` directly — it calls `read`, and
 * `read` is the only thing allowed to call `load`.
 */
export interface PromiseCache<K, V> {
  /**
   * The promise for `key`, starting it on first call.
   *
   * Safe to call during render: repeated calls with the same key return the
   * identical promise object until the entry is invalidated.
   */
  read(key: K): Promise<V>;
  /**
   * Drops the entry so the next `read` starts a fresh request.
   *
   * This is the retry primitive. It has to be explicit — see the note on
   * rejected entries below.
   */
  invalidate(key: K): boolean;
  /** Drops every entry. */
  clear(): void;
  /** Whether `key` currently has an entry. Diagnostics and tests. */
  has(key: K): boolean;
  /** Number of live entries. Diagnostics and tests. */
  size(): number;
}

export interface PromiseCacheOptions<K, V> {
  /** Starts the request for `key`. Called at most once per cached entry. */
  load: (key: K) => Promise<V>;
}

/**
 * Builds a {@link PromiseCache} over `load`.
 *
 * Keys are compared with `Map` semantics (SameValueZero), so use primitives —
 * an object key would produce a fresh entry on every render.
 *
 * ### Rejected entries are kept on purpose
 *
 * The tempting behaviour is to delete an entry when its promise rejects, so
 * the next read retries automatically. That turns a visible error into an
 * invisible hang. React's retry sequence after a rejection is:
 *
 * 1. the promise rejects, and React re-renders the suspended component;
 * 2. the component calls `read(key)` again;
 * 3. `use()` looks at whatever comes back.
 *
 * If the rejected promise is still there, `use()` rethrows synchronously and
 * the error reaches the nearest error boundary. If it was dropped, step 2
 * hands back a brand-new *pending* promise, the component suspends instead of
 * throwing, and the boundary shows its fallback again — forever, re-requesting
 * on every pass. The error never surfaces.
 *
 * So a rejected entry is sticky, and retrying is a deliberate act: call
 * `invalidate(key)` before resetting the error boundary. `<ProfilePanel>` is
 * the worked example.
 *
 * Usage:
 *   const cache = createPromiseCache({ load: (id: string) => api.fetchProfile(id) });
 *   function Profile({ id }: { id: string }) {
 *     const profile = use(cache.read(id)); // same promise every render
 *   }
 */
export function createPromiseCache<K, V>({ load }: PromiseCacheOptions<K, V>): PromiseCache<K, V> {
  const entries = new Map<K, Promise<V>>();

  return {
    read(key) {
      const existing = entries.get(key);
      if (existing !== undefined) return existing;

      const promise = load(key);
      // A cached rejection may sit unobserved for a while — the entry is
      // created during render, and `use()` only observes it on the retry pass;
      // an entry nothing ever reads again is never observed at all. Without
      // this no-op handler that is an unhandled rejection, which fails CI under
      // `--throw-deprecation`-style strictness and crashes a Node process
      // outright. Attaching it does not consume the rejection for `use()`:
      // `catch` returns a *new* promise and the original, still rejected, is
      // what gets stored.
      promise.catch(() => {
        // Observed here only so the runtime does not report it as unhandled.
        // The real handling is `use()` rethrowing into an error boundary.
      });

      entries.set(key, promise);
      return promise;
    },

    invalidate(key) {
      return entries.delete(key);
    },

    clear() {
      entries.clear();
    },

    has(key) {
      return entries.has(key);
    },

    size() {
      return entries.size;
    },
  };
}
