/**
 * The three caching strategies this worker uses, and the rules about what may
 * enter a cache at all.
 *
 * Every function here takes its cache and its `fetch` as arguments rather than
 * reaching for `caches` or the global `fetch`. That is what makes them
 * testable outside a service worker — jsdom implements neither — and it is
 * also what makes the worker's own wiring readable: `sw.ts` is the only file
 * that knows which cache is which.
 */

/**
 * The part of `Cache` these strategies use.
 *
 * A real `Cache` satisfies it; so does a `Map`-backed fake in twenty lines,
 * which is what the tests use. Depending on the whole `Cache` interface would
 * mean a fake that implements `addAll`, `matchAll` and `add` for no reason.
 */
export interface CacheLike {
  match(request: RequestInfo): Promise<Response | undefined>;
  put(request: RequestInfo, response: Response): Promise<void>;
  delete(request: RequestInfo): Promise<boolean>;
  keys(): Promise<readonly Request[]>;
}

/** The network, as a dependency. */
export type FetchLike = (request: Request) => Promise<Response>;

export interface StrategyInput {
  readonly cache: CacheLike;
  readonly request: Request;
  readonly fetch: FetchLike;
}

export interface StrategyResult {
  /** What the page gets. */
  readonly response: Response;
  /**
   * Work that outlives the response and must be passed to `event.waitUntil`.
   *
   * The whole point of stale-while-revalidate is that the response arrives
   * before the revalidation finishes. A service worker is killed when the
   * browser judges it idle, and a promise nobody declared is not a reason to
   * stay alive — so a revalidation that is not extended here is a revalidation
   * that runs on a fast machine, does not run on a slow one, and produces a
   * cache that updates depending on the device.
   */
  readonly done: Promise<unknown>;
  readonly source: "cache" | "network" | "offline";
}

/**
 * Whether a response may be stored.
 *
 * `response.ok` does most of the work and one thing that is easy to miss: an
 * opaque cross-origin response has status `0`, so it fails here rather than
 * being stored as a success nobody can read. The rest are responses that are
 * *valid* and still must not be stored:
 *
 * - **206 Partial Content** — `Cache.put` rejects it, and a cache entry that
 *   is part of a body is worse than no entry.
 * - **`no-store`** — the only cache directive that is a hard prohibition
 *   rather than a freshness hint, and the one an authenticated endpoint uses
 *   to say "not on disk". A cache that ignores it leaks one user's data to the
 *   next person on the device.
 *
 * `no-cache` is deliberately *not* here: it means "revalidate before use",
 * which is precisely what stale-while-revalidate does.
 */
export function isCacheable(response: Response): boolean {
  if (!response.ok) return false;
  if (response.status === 206) return false;
  if (response.type === "opaque" || response.type === "opaqueredirect") return false;
  const directives = response.headers.get("cache-control") ?? "";
  return !/(^|,)\s*no-store/i.test(directives);
}

/**
 * Serve what is stored, then replace it.
 *
 * The response is whatever the cache holds, returned without waiting for the
 * network; the network result updates the cache for next time. A user on a
 * slow connection sees the last-known answer immediately and the fresh one on
 * their next visit to the view — which is the correct trade for a feed, a
 * profile or a report, and the wrong one for a balance or a stock level. The
 * strategy cannot tell those apart; `routing.ts` can, and `docs/offline.md`
 * says what to do about the ones it gets wrong.
 *
 * A failed revalidation is not an error here. Being offline is the expected
 * case, and the cached response has already been returned — reporting the
 * failure would turn a working page into a console full of noise.
 */
export function staleWhileRevalidate(input: StrategyInput): Promise<StrategyResult> {
  const { cache, request, fetch } = input;
  return cache.match(request).then((cached) => {
    const revalidation = fetch(request)
      .then(async (response) => {
        // `put` consumes the body, so the response handed back to the page has
        // to be a different one. Cloning *before* either is read is the only
        // ordering that works: a `Response` whose body has started streaming
        // cannot be cloned.
        if (isCacheable(response)) await cache.put(request, response.clone());
        return response;
      })
      .catch(() => undefined);

    if (cached !== undefined) {
      return { response: cached, done: revalidation, source: "cache" as const };
    }
    // Nothing stored: the network is no longer an optimisation, it is the
    // response, so this is the one path that waits for it.
    return revalidation.then((fresh) => ({
      response: fresh ?? offlineResponse(request),
      done: Promise.resolve(),
      source: fresh === undefined ? ("offline" as const) : ("network" as const),
    }));
  });
}

/**
 * Serve what is stored and do not check.
 *
 * Correct only for a URL whose contents cannot change, which in a Vite build
 * means a filename containing a content hash. Used for the precache and
 * nowhere else: applied to a mutable URL it produces a page that is stale
 * until the cache is deleted, which is the bug service workers are famous for.
 */
export function cacheFirst(input: StrategyInput): Promise<StrategyResult> {
  const { cache, request, fetch } = input;
  return cache.match(request).then(async (cached) => {
    if (cached !== undefined) {
      return { response: cached, done: Promise.resolve(), source: "cache" as const };
    }
    try {
      const response = await fetch(request);
      if (isCacheable(response)) await cache.put(request, response.clone());
      return { response, done: Promise.resolve(), source: "network" as const };
    } catch {
      return {
        response: offlineResponse(request),
        done: Promise.resolve(),
        source: "offline" as const,
      };
    }
  });
}

/**
 * Answer a navigation with the cached application shell.
 *
 * A single-page application has no file behind `/reports/3`: the server
 * returns `index.html` for every path and the router reads the URL. Offline,
 * the worker plays that server. The shell is read from the precache by URL —
 * not by the navigation request, which would never match — and the network is
 * only consulted when the precache has no shell at all, which happens on the
 * very first navigation after an install that has not finished.
 *
 * Not revalidated per navigation on purpose. `index.html` is the one unhashed
 * file in the build, so the temptation is to treat it as mutable; but its
 * contents are the hashed script tags of *this* build, and the thing that
 * makes a new build's shell appear is the worker update — a new precache under
 * a new name, all at once. Revalidating here would let a new `index.html`
 * reference assets that the current precache does not contain.
 */
export function appShell(
  input: StrategyInput & { readonly shellUrl: string },
): Promise<StrategyResult> {
  const { cache, request, fetch, shellUrl } = input;
  return cache.match(shellUrl).then(async (cached) => {
    if (cached !== undefined) {
      return { response: cached, done: Promise.resolve(), source: "cache" as const };
    }
    try {
      return {
        response: await fetch(request),
        done: Promise.resolve(),
        source: "network" as const,
      };
    } catch {
      return {
        response: offlineResponse(request),
        done: Promise.resolve(),
        source: "offline" as const,
      };
    }
  });
}

/**
 * Keeps a runtime cache from growing without limit, oldest entry first.
 *
 * `Cache.keys()` resolves in insertion order, which is the only ordering the
 * Cache API offers — there are no timestamps, so "least recently used" is not
 * available without a second store to track reads. Insertion order is a worse
 * eviction policy and a much smaller amount of machinery, and the thing it has
 * to prevent is unbounded growth rather than a poor hit rate.
 */
export async function trimCache(cache: CacheLike, maxEntries: number): Promise<number> {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return 0;
  const excess = keys.slice(0, keys.length - maxEntries);
  for (const key of excess) await cache.delete(key);
  return excess.length;
}

/**
 * The response for "there is no network and nothing stored".
 *
 * A `503` rather than a thrown error, because a rejected `respondWith` renders
 * the browser's own network-error page — which in a running application means
 * the shell is replaced by chrome that says nothing about what failed. A
 * status the application can see keeps the failure inside the application,
 * where `RouteErrorBoundary` already knows how to present it.
 */
export function offlineResponse(request: Request): Response {
  return new Response(
    JSON.stringify({
      error: "offline",
      message: "No network and no cached copy.",
      url: request.url,
    }),
    {
      status: 503,
      statusText: "Offline",
      headers: { "content-type": "application/json", "x-offline": "1" },
    },
  );
}
