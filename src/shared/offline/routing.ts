import { API_PREFIX, MUTATING_METHODS } from "@/shared/offline/config";

/**
 * Everything the routing decision reads from a request.
 *
 * The indirection is not ceremony. `Request` cannot be constructed with the
 * one property that matters most here — `new Request(url, { mode: "navigate" })`
 * throws `TypeError` in every engine, by specification, because navigation
 * requests are the browser's to make. A router that takes a `Request` is
 * therefore a router whose navigation branch cannot be unit tested at all, and
 * the navigation branch is the branch that decides whether the application
 * opens offline.
 */
export interface RequestFacts {
  readonly url: string;
  readonly method: string;
  /** `"navigate"`, `"cors"`, `"same-origin"`, `"no-cors"`. */
  readonly mode: string;
  /** `"document"`, `"script"`, `"style"`, `"image"`, `""` for `fetch()`. */
  readonly destination: string;
  /** True when the request carries a `Range` header. */
  readonly ranged: boolean;
}

/** Reads the routing-relevant parts of a real request. */
export function describeRequest(request: Request): RequestFacts {
  return {
    url: request.url,
    method: request.method,
    mode: request.mode,
    destination: request.destination,
    ranged: request.headers.get("range") !== null,
  };
}

export interface RouteConfig {
  /** Origin the worker is installed on; anything else is somebody else's. */
  readonly origin: string;
  /**
   * Pathnames written into the precache at install time. Build assets carry a
   * content hash, so membership here means "immutable and already stored",
   * which is what makes cache-first safe for them and only for them.
   */
  readonly precachedPaths: ReadonlySet<string>;
}

/**
 * What the worker should do with a request.
 *
 * `passthrough` is deliberately the widest branch. Every other value commits
 * the worker to producing a `Response`, and a worker that answers a request it
 * does not understand has taken a request the browser would have handled
 * correctly and made it this code's problem — including the failure modes,
 * which now happen with no network stack underneath to explain them.
 */
export type Route =
  "app-shell" | "precached-asset" | "runtime-cache" | "queue-write" | "passthrough";

/**
 * Picks a strategy for one request.
 *
 * The order of the branches is the design:
 *
 * 1. **Writes first.** A `POST` to the API is the only request that may be
 *    *queued*, and it must be recognised before any GET-shaped reasoning runs.
 * 2. **Cross-origin is somebody else's.** A cross-origin `GET` without CORS
 *    yields an opaque response: status `0`, headers empty, indistinguishable
 *    from a failure, and padded to a multiple of 32MB against the origin's
 *    storage quota. Caching one is how a worker fills a user's disk with a
 *    404 it cannot read.
 * 3. **Navigations before assets**, because a navigation to `/reports/3` has
 *    no file behind it in a single-page application — the shell is the
 *    response, and the router does the rest.
 * 4. **Precached assets are cache-first**, because a content hash in the
 *    filename is a promise that the bytes never change.
 * 5. **Everything else same-origin is stale-while-revalidate**, which is the
 *    right default for data whose staleness is measured in seconds and wrong
 *    for data whose staleness is measured in cents. See `docs/offline.md`.
 */
export function routeRequest(facts: RequestFacts, config: RouteConfig): Route {
  const url = parseUrl(facts.url);
  if (url === null) return "passthrough";
  const sameOrigin = url.origin === config.origin;
  const isApi = sameOrigin && url.pathname.startsWith(API_PREFIX);

  if (MUTATING_METHODS.has(facts.method)) {
    return isApi ? "queue-write" : "passthrough";
  }
  // `HEAD` is a read, but nothing sensible can be cached from a body-less
  // response, and serving a cached `GET` body for one would be a lie.
  if (facts.method !== "GET") return "passthrough";

  // A `Range` request wants part of a body. `Cache.put` rejects a 206 outright,
  // and answering from a complete cached entry would return more bytes than
  // were asked for — which is how a `<video>` that seeks stops playing.
  if (facts.ranged) return "passthrough";

  if (!sameOrigin) return "passthrough";

  // `destination` is the fallback because Safari left `mode` as `"navigate"`
  // only on the main resource for years; the two agree in current engines and
  // disagree on exactly the browsers that need the shell most.
  if (facts.mode === "navigate" || facts.destination === "document") return "app-shell";

  if (config.precachedPaths.has(url.pathname)) return "precached-asset";

  return "runtime-cache";
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
