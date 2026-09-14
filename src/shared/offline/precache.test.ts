import { describe, it, expect, vi } from "vitest";
import {
  deleteStaleCaches,
  populatePrecache,
  precachedPathsOf,
  type CacheStorageLike,
} from "@/shared/offline/precache";
import { CACHE_PREFIX, precacheName, RUNTIME_CACHE } from "@/shared/offline/config";
import { createFakeCache } from "@/test/offlineCache";

/**
 * Where the worker's script would live. Root-relative precache entries resolve
 * against it exactly as they would against `location.href` in a real worker.
 */
const BASE = "https://app.test/sw.js";

function ok(body = "asset"): Response {
  return new Response(body, { status: 200 });
}

describe("populatePrecache", () => {
  it("stores every URL under its own address", async () => {
    const cache = createFakeCache();
    const report = await populatePrecache(
      cache,
      ["/index.html", "/assets/index-a1b2c3.js"],
      () => Promise.resolve(ok()),
      BASE,
    );

    expect(report.failed).toEqual([]);
    expect(report.cached).toEqual(["/index.html", "/assets/index-a1b2c3.js"]);
    // Stored under the plain URL rather than under the `reload` request, so a
    // later `match("/index.html")` finds it.
    expect(await cache.match("/index.html")).toBeDefined();
  });

  it("bypasses the HTTP cache", async () => {
    // Without `cache: "reload"` the precache can be filled from the same stale
    // HTTP cache entry the deploy just invalidated — and a precache is
    // immutable, so a wrong entry stays wrong until the next build.
    const fetchFn = vi.fn((_request: Request) => Promise.resolve(ok()));
    await populatePrecache(createFakeCache(), ["/index.html"], fetchFn, BASE);
    expect(fetchFn.mock.lastCall?.[0].cache).toBe("reload");
  });

  it("reports which URL failed rather than only that one did", async () => {
    const report = await populatePrecache(
      createFakeCache(),
      ["/a.js", "/b.js"],
      (request) =>
        request.url.endsWith("/b.js")
          ? Promise.resolve(new Response("nope", { status: 404 }))
          : Promise.resolve(ok()),
      BASE,
    );
    expect(report.cached).toEqual(["/a.js"]);
    expect(report.failed).toEqual([{ url: "/b.js", reason: "HTTP 404" }]);
  });

  it("reports a network failure with its message", async () => {
    const report = await populatePrecache(
      createFakeCache(),
      ["/a.js"],
      () => Promise.reject(new Error("connection reset")),
      BASE,
    );
    expect(report.failed).toEqual([{ url: "/a.js", reason: "connection reset" }]);
  });

  it("does not stop at the first failure", async () => {
    // `cache.addAll` would: one rejection fails the batch and names nothing.
    const report = await populatePrecache(
      createFakeCache(),
      ["/a.js", "/b.js", "/c.js"],
      (request) =>
        request.url.endsWith("/a.js") ? Promise.reject(new Error("boom")) : Promise.resolve(ok()),
      BASE,
    );
    expect(report.cached).toEqual(["/b.js", "/c.js"]);
    expect(report.failed).toHaveLength(1);
  });
});

describe("deleteStaleCaches", () => {
  function storage(names: string[]): CacheStorageLike & { deleted: string[] } {
    const deleted: string[] = [];
    return {
      deleted,
      keys: () => Promise.resolve(names),
      delete: (name) => {
        deleted.push(name);
        return Promise.resolve(true);
      },
    };
  }

  it("deletes this application's previous builds", async () => {
    const store = storage([precacheName("old1"), precacheName("new1"), RUNTIME_CACHE]);
    const deleted = await deleteStaleCaches(store, new Set([precacheName("new1"), RUNTIME_CACHE]));
    expect(deleted).toEqual([precacheName("old1")]);
  });

  it("leaves caches that belong to something else on the origin", async () => {
    // `caches` is origin-scoped: a sibling deployment, an older framework or
    // MSW's own storage can share it, and deleting everything on activate is a
    // bug that only appears on the origin where something else was running.
    const store = storage(["msw-cache", "some-other-app-precache", `${CACHE_PREFIX}-precache-old`]);
    const deleted = await deleteStaleCaches(store, new Set());
    expect(deleted).toEqual([`${CACHE_PREFIX}-precache-old`]);
  });
});

describe("precachedPathsOf", () => {
  it("reduces URLs to the pathnames routing compares", () => {
    // Routing sees absolute request URLs and the plan holds relative ones;
    // comparing them raw would make the list wrong on every origin but the one
    // it was built for, preview deployments included.
    expect([...precachedPathsOf(["/index.html", "/assets/a.js?v=1"])]).toEqual([
      "/index.html",
      "/assets/a.js",
    ]);
  });

  it("drops an entry that is not a URL at all", () => {
    expect([...precachedPathsOf(["http://", "/ok.js"])]).toEqual(["/ok.js"]);
  });
});
