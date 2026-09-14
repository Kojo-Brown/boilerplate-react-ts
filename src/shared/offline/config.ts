/**
 * The names and constants both halves of the offline story agree on.
 *
 * The service worker and the page are separate programs that happen to be
 * built from one repository: they share no memory, no module instance and no
 * lifetime. Everything they have to agree on — which cache holds what, which
 * header marks a queued write, which tag the browser wakes the worker with —
 * is a string, and a string duplicated across two programs is a string that
 * will disagree after the refactor that only touched one of them.
 */

/**
 * Prefix for every cache this application owns.
 *
 * `caches` is origin-scoped, not application-scoped: on a shared origin the
 * MSW worker, a previous framework, and anything else that ever ran here own
 * caches too. Activation deletes stale caches, and it may only delete caches
 * that are *ours* — which is what this prefix decides.
 */
export const CACHE_PREFIX = "boilerplate-react-ts";

/**
 * Cache holding the build's own assets, keyed by build.
 *
 * The build id is part of the name rather than a field inside the cache
 * because a deploy must not be able to half-apply. A single cache mutated in
 * place spends the window between "new entries written" and "old entries
 * deleted" serving a mixture of two builds, and a hashed asset graph is
 * exactly the thing that cannot survive being half of each. A new name means
 * the new build is invisible until it is complete, and the old one keeps
 * working until the moment it is replaced.
 */
export function precacheName(buildId: string): string {
  return `${CACHE_PREFIX}-precache-${buildId}`;
}

/**
 * Cache for things fetched at runtime: API reads, `public/` assets, anything
 * the build did not know about. Not keyed by build — its contents are not
 * invalidated by a deploy, and re-fetching them all on every deploy is the
 * cost this separation avoids. The version suffix is for changes to the
 * *shape* of what is stored, which is a change only this file can make.
 */
export const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime-v1`;

/**
 * Entries kept in the runtime cache.
 *
 * A bound is required, not tidy: storage is a shared origin quota, and a
 * worker that caches every API response a user ever fetches is a worker that
 * eventually has its whole origin evicted by the browser — precache included.
 * Sixty is roughly "a session's worth of reads" and is deliberately a number
 * to change when a profile says so, rather than a computation nobody can
 * predict.
 */
export const RUNTIME_CACHE_MAX_ENTRIES = 60;

/** True for caches this application is allowed to delete. */
export function isOwnCache(name: string): boolean {
  return name.startsWith(`${CACHE_PREFIX}-`);
}

/**
 * Path prefix that identifies an API request.
 *
 * Same-origin by construction: `vite.config.ts` proxies `/api` in development
 * and a deployment is expected to do the same. A cross-origin API would work
 * too, but it would need CORS on every cached response and would make opaque
 * responses (which have no status and cannot be told apart from a failure)
 * reachable — see `strategies.ts`.
 */
export const API_PREFIX = "/api";

/** The Background Sync tag this application registers. */
export const SYNC_TAG = "offline-queue-replay";

/**
 * Marks the synthetic response returned for a write that was queued rather
 * than sent. Application code that treats a `202` as "saved" is wrong in a way
 * no header can fix, but a header at least lets it be right on purpose.
 */
export const QUEUED_HEADER = "x-offline-queued";

/**
 * Stamped on every queued write that does not already carry one.
 *
 * A replayed request is by definition a request the client is not sure the
 * server ever saw: the network failed after the bytes left. Replay without an
 * idempotency key turns "maybe it arrived" into "it arrived twice", and the
 * duplicate is created by the offline feature itself. The key is generated at
 * enqueue time — not at replay time — so every attempt carries the same one.
 */
export const IDEMPOTENCY_HEADER = "idempotency-key";

/** Methods that change server state, and so are queued rather than failed. */
export const MUTATING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** URL of the cached application shell, served for any navigation offline. */
export const APP_SHELL_URL = "/index.html";
