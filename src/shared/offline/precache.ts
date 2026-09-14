import { isOwnCache } from "@/shared/offline/config";
import type { CacheLike, FetchLike } from "@/shared/offline/strategies";

/** The part of `CacheStorage` activation needs. */
export interface CacheStorageLike {
  keys(): Promise<readonly string[]>;
  delete(name: string): Promise<boolean>;
}

export interface PrecacheReport {
  readonly cached: readonly string[];
  readonly failed: readonly { readonly url: string; readonly reason: string }[];
}

/**
 * Fills the precache with the build's own assets.
 *
 * Three decisions are worth the words:
 *
 * **`cache: "reload"`.** Without it the fetch may be answered from the HTTP
 * cache, and the HTTP cache is exactly where a stale copy of a file lives when
 * a deploy has just replaced it. Precaching from it produces a cache that is
 * confidently wrong and immutable — the worst of both. Hashed filenames make
 * this unlikely; `index.html` makes it possible.
 *
 * **Requests are made one at a time, not with `cache.addAll`.** `addAll` fails
 * the whole batch on the first failure and tells you nothing about which URL
 * it was. Precaching is the step most likely to fail on a flaky connection,
 * and "install failed" with no URL is not a debuggable message.
 *
 * **The report is returned rather than thrown on.** The caller decides whether
 * a partial precache is fatal, and in `sw.ts` it is: a worker that activates
 * with an incomplete precache serves an application shell whose scripts are
 * not stored, which fails at the first navigation offline instead of at
 * install, where a retry is free and invisible.
 */
export async function populatePrecache(
  cache: CacheLike,
  urls: readonly string[],
  fetchFn: FetchLike,
  /**
   * What the root-relative entries resolve against — the worker's own script
   * URL in production. A parameter rather than a read of the ambient
   * `location` because `Request` outside a browsing context requires an
   * absolute URL, so a default-only version could not be tested at all.
   */
  baseUrl: string = location.href,
): Promise<PrecacheReport> {
  const cached: string[] = [];
  const failed: { url: string; reason: string }[] = [];

  for (const url of urls) {
    try {
      const request = new Request(new URL(url, baseUrl), {
        cache: "reload",
        credentials: "same-origin",
      });
      const response = await fetchFn(request);
      if (!response.ok) {
        failed.push({ url, reason: `HTTP ${response.status}` });
        continue;
      }
      // Stored under the plain URL, not under the `reload` request: a cache
      // entry is keyed by its request, and a later `match("/index.html")` must
      // find this one.
      await cache.put(url, response.clone());
      cached.push(url);
    } catch (error) {
      failed.push({ url, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { cached, failed };
}

/**
 * Deletes this application's caches that the new build does not use.
 *
 * Scoped to caches carrying our prefix, because `caches` belongs to the
 * origin rather than to this application: a sibling deployment, an older
 * framework, or the MSW worker's own storage may live beside it, and deleting
 * everything on activate is a bug that only shows up on the origin where
 * something else was also running.
 */
export async function deleteStaleCaches(
  storage: CacheStorageLike,
  keep: ReadonlySet<string>,
): Promise<readonly string[]> {
  const names = await storage.keys();
  const deleted: string[] = [];
  for (const name of names) {
    if (!isOwnCache(name) || keep.has(name)) continue;
    await storage.delete(name);
    deleted.push(name);
  }
  return deleted;
}

/**
 * The pathnames of the precached URLs, for `routing.ts`.
 *
 * Routing compares pathnames because a request's URL is absolute and the
 * precache list is relative — and because comparing absolute URLs would make
 * the list wrong on any origin but the one it was built for, which includes
 * every preview deployment.
 */
export function precachedPathsOf(urls: readonly string[]): ReadonlySet<string> {
  const paths = new Set<string>();
  for (const url of urls) {
    try {
      paths.add(new URL(url, "http://precache.invalid").pathname);
    } catch {
      // A malformed entry cannot match a request either; dropping it here
      // keeps the failure in the build step that produced it.
    }
  }
  return paths;
}
