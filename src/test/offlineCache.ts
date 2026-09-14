import type { CacheLike } from "@/shared/offline/strategies";

/**
 * A `Cache` in a `Map`.
 *
 * jsdom implements no Cache API, so the alternative to this is not "test
 * against the real thing", it is "do not test the caching strategies at all".
 * It keeps the two behaviours the strategies actually depend on: entries are
 * keyed by request URL, and `keys()` returns them in insertion order, which is
 * what `trimCache` evicts by.
 */
export interface FakeCache extends CacheLike {
  /** Stored responses, oldest first. Assert on this rather than on `match`. */
  readonly urls: () => string[];
  readonly size: () => number;
}

function keyOf(request: RequestInfo): string {
  return typeof request === "string"
    ? new URL(request, "http://localhost").toString()
    : request.url;
}

export function createFakeCache(initial: Readonly<Record<string, Response>> = {}): FakeCache {
  const entries = new Map<string, Response>();
  for (const [url, response] of Object.entries(initial)) entries.set(keyOf(url), response);

  return {
    match(request) {
      return Promise.resolve(entries.get(keyOf(request)));
    },
    put(request, response) {
      entries.set(keyOf(request), response);
      return Promise.resolve();
    },
    delete(request) {
      return Promise.resolve(entries.delete(keyOf(request)));
    },
    keys() {
      return Promise.resolve([...entries.keys()].map((url) => new Request(url)));
    },
    urls: () => [...entries.keys()],
    size: () => entries.size,
  };
}
