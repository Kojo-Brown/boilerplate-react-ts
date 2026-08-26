/**
 * A promise cache for a page made of several differently-typed sections.
 *
 * `createPromiseCache` covers one request shape keyed by id — many profiles,
 * all `UserProfile`. A streaming page is the other axis: a fixed set of named
 * sections, each with its own type and its own request. Keying that by string
 * would collapse the value types to a union and push a narrowing cast into
 * every component; this keeps `read("breakdown")` returning
 * `Promise<BreakdownRow[]>` and nothing else.
 *
 * Everything `promiseCache.ts` documents still applies and is not repeated
 * here: `read` must be the only thing that starts a request, rendering must
 * never call a loader directly, and a rejected entry is sticky so the retry
 * stays a deliberate act. What this adds is {@link SectionCache.prefetch}.
 */

/** The section-name → value-type mapping a cache is built over. */
export type SectionMap = Record<string, unknown>;

/** The section names of `M`, as a string union. */
export type SectionKey<M extends SectionMap> = keyof M & string;

/** One request starter per section. Each is called at most once per entry. */
export type SectionLoaders<M extends SectionMap> = {
  readonly [K in keyof M]: () => Promise<M[K]>;
};

export interface SectionCache<M extends SectionMap> {
  /**
   * The promise for `section`, starting it on first call.
   *
   * Safe to call during render, and stable per section until invalidated —
   * the precondition for handing it to `use()`.
   */
  read<K extends SectionKey<M>>(section: K): Promise<M[K]>;

  /**
   * Starts `sections` without reading them.
   *
   * This is the whole reason the type exists as something more than a `Map`.
   * A component only starts its request when it renders, and a component
   * inside a `<Suspense>` boundary does not render until everything above it
   * has resolved — so the natural way to write a nested page produces a
   * request waterfall: the sections wait on the shell, having asked for
   * nothing, purely because they had not been reached yet.
   *
   * `prefetch` decouples *when a request starts* from *where its data is
   * read*. It has to be called from a component that will not itself suspend,
   * above the boundary that would otherwise gate the sections — calling it
   * inside the suspending shell is the same waterfall with extra steps, since
   * that render is exactly what is being delayed.
   *
   * Discarding the promises is safe: `read` attaches a no-op rejection
   * handler, so an unread failure does not surface as an unhandled rejection,
   * and the real error still reaches the component that eventually reads it.
   *
   * Usage:
   *   function Report({ cache }) {
   *     cache.prefetch("summary", "breakdown");   // above the boundary
   *     return <Suspense …><Shell cache={cache} /></Suspense>;
   *   }
   */
  prefetch(...sections: readonly SectionKey<M>[]): void;

  /** Drops the entry so the next `read` starts a fresh request. */
  invalidate(section: SectionKey<M>): boolean;

  /** Drops every entry. */
  clear(): void;

  /**
   * Which sections have been started, in the order they were started.
   *
   * Diagnostics and tests: "did the shell start the breakdown request, or did
   * the breakdown component start it after the shell resolved" is the question
   * this whole module is about, and it should be answerable rather than
   * inferred from timing.
   */
  startedSections(): readonly SectionKey<M>[];
}

/**
 * Builds a {@link SectionCache} from one loader per section.
 *
 * Usage:
 *   const cache = createSectionCache<ReportSections>({
 *     summary: () => api.fetchSummary(),
 *     breakdown: () => api.fetchBreakdown(),
 *   });
 */
export function createSectionCache<M extends SectionMap>(
  loaders: SectionLoaders<M>,
): SectionCache<M> {
  // Heterogeneous by construction, so the store is typed at its loosest and
  // narrowed once, on the way out of `read`. The cast is sound because an
  // entry for `section` can only have come from `loaders[section]`, which
  // returns `Promise<M[typeof section]>` — nothing else writes to this map.
  const entries = new Map<SectionKey<M>, Promise<unknown>>();
  const started: SectionKey<M>[] = [];

  function start<K extends SectionKey<M>>(section: K): Promise<M[K]> {
    const existing = entries.get(section);
    if (existing !== undefined) return existing as Promise<M[K]>;

    // The mapped type already guarantees a loader per section, so this is
    // unreachable from typed code — and reachable from anything that crossed a
    // boundary the types do not cover, which is exactly when a silent
    // `undefined is not a function` is hardest to trace back.
    if (!(section in loaders)) {
      throw new Error(`No loader registered for section "${section}".`);
    }

    const promise = loaders[section]();
    // See `promiseCache.ts`: an entry created during render is not observed
    // until the retry pass, and a prefetched entry nobody reads is never
    // observed at all. Without this handler that is an unhandled rejection.
    // `catch` returns a new promise; the original rejected one is what is
    // stored, so `use()` still rethrows it.
    promise.catch(() => {
      // Observed only so the runtime does not report it as unhandled. The
      // real handling is `use()` rethrowing into an error boundary.
    });

    entries.set(section, promise);
    started.push(section);
    return promise;
  }

  return {
    read: start,

    prefetch(...sections) {
      // Discarding the promise is the point — see the note on `prefetch` for
      // why an unread rejection here is safe.
      for (const section of sections) void start(section);
    },

    invalidate(section) {
      return entries.delete(section);
    },

    clear() {
      entries.clear();
    },

    startedSections() {
      return [...started];
    },
  };
}
