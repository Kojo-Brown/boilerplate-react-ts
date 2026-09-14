import { describe, it, expect, vi } from "vitest";
import {
  appShell,
  cacheFirst,
  isCacheable,
  offlineResponse,
  staleWhileRevalidate,
  trimCache,
} from "@/shared/offline/strategies";
import { createFakeCache } from "@/test/offlineCache";

const URL_A = "https://app.test/api/posts";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("isCacheable", () => {
  it("accepts an ordinary 200", () => {
    expect(isCacheable(json({ ok: true }))).toBe(true);
  });

  it("rejects an error response", () => {
    expect(isCacheable(new Response("nope", { status: 500 }))).toBe(false);
  });

  it("rejects a partial response", () => {
    // `Cache.put` rejects a 206 outright; storing part of a body would be
    // worse than storing nothing.
    expect(isCacheable(new Response("chunk", { status: 206 }))).toBe(false);
  });

  it("rejects `no-store`", () => {
    // The one cache directive that is a prohibition rather than a freshness
    // hint. Ignoring it leaks one user's data to the next person on the device.
    expect(isCacheable(json({}, { headers: { "cache-control": "private, no-store" } }))).toBe(
      false,
    );
  });

  it("accepts `no-cache`, which means revalidate rather than do not store", () => {
    expect(isCacheable(json({}, { headers: { "cache-control": "no-cache" } }))).toBe(true);
  });
});

describe("staleWhileRevalidate", () => {
  it("answers from the cache without waiting for the network", async () => {
    const cache = createFakeCache({ [URL_A]: json({ from: "cache" }) });
    let resolveFetch: (response: Response) => void = () => undefined;
    const fetchFn = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const result = await staleWhileRevalidate({
      cache,
      request: new Request(URL_A),
      fetch: fetchFn,
    });

    // The network has not answered and the page already has a response. That
    // is the entire strategy.
    expect(result.source).toBe("cache");
    expect(await result.response.json()).toEqual({ from: "cache" });

    resolveFetch(json({ from: "network" }));
    await result.done;
    expect(await (await cache.match(URL_A))?.json()).toEqual({ from: "network" });
  });

  it("returns the network response when nothing is cached", async () => {
    const cache = createFakeCache();
    const result = await staleWhileRevalidate({
      cache,
      request: new Request(URL_A),
      fetch: () => Promise.resolve(json({ from: "network" })),
    });
    expect(result.source).toBe("network");
    expect(await result.response.json()).toEqual({ from: "network" });
  });

  it("keeps serving the cached copy when the network fails", async () => {
    const cache = createFakeCache({ [URL_A]: json({ from: "cache" }) });
    const result = await staleWhileRevalidate({
      cache,
      request: new Request(URL_A),
      fetch: () => Promise.reject(new Error("offline")),
    });

    expect(result.source).toBe("cache");
    // A failed revalidation is the expected case offline: it must not reject
    // `done`, or every `waitUntil` in the worker becomes an unhandled rejection.
    await expect(result.done).resolves.toBeUndefined();
    expect(await (await cache.match(URL_A))?.json()).toEqual({ from: "cache" });
  });

  it("returns a 503 when there is neither a cached copy nor a network", async () => {
    const result = await staleWhileRevalidate({
      cache: createFakeCache(),
      request: new Request(URL_A),
      fetch: () => Promise.reject(new Error("offline")),
    });
    expect(result.source).toBe("offline");
    expect(result.response.status).toBe(503);
  });

  it("does not store a response the server said not to store", async () => {
    const cache = createFakeCache();
    const result = await staleWhileRevalidate({
      cache,
      request: new Request(URL_A),
      fetch: () =>
        Promise.resolve(json({ secret: true }, { headers: { "cache-control": "no-store" } })),
    });
    await result.done;
    expect(cache.size()).toBe(0);
  });

  it("hands the page a readable body after caching one", async () => {
    // The bug this catches is `cache.put(request, response)` without the
    // clone: the body is consumed by the cache and the page gets a stream
    // that has already been read.
    const cache = createFakeCache();
    const result = await staleWhileRevalidate({
      cache,
      request: new Request(URL_A),
      fetch: () => Promise.resolve(json({ from: "network" })),
    });
    await result.done;
    expect(await result.response.json()).toEqual({ from: "network" });
    expect(await (await cache.match(URL_A))?.json()).toEqual({ from: "network" });
  });
});

describe("cacheFirst", () => {
  it("never touches the network for a stored entry", async () => {
    const fetchFn = vi.fn(() => Promise.resolve(json({ from: "network" })));
    const result = await cacheFirst({
      cache: createFakeCache({ [URL_A]: json({ from: "cache" }) }),
      request: new Request(URL_A),
      fetch: fetchFn,
    });
    expect(result.source).toBe("cache");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("fetches and stores on a miss", async () => {
    const cache = createFakeCache();
    const result = await cacheFirst({
      cache,
      request: new Request(URL_A),
      fetch: () => Promise.resolve(json({ from: "network" })),
    });
    expect(result.source).toBe("network");
    expect(await (await cache.match(URL_A))?.json()).toEqual({ from: "network" });
  });

  it("does not store a 404", async () => {
    const cache = createFakeCache();
    const result = await cacheFirst({
      cache,
      request: new Request(URL_A),
      fetch: () => Promise.resolve(new Response("missing", { status: 404 })),
    });
    expect(result.response.status).toBe(404);
    expect(cache.size()).toBe(0);
  });

  it("falls back to a 503 when the network fails on a miss", async () => {
    const result = await cacheFirst({
      cache: createFakeCache(),
      request: new Request(URL_A),
      fetch: () => Promise.reject(new Error("offline")),
    });
    expect(result.source).toBe("offline");
    expect(result.response.status).toBe(503);
  });
});

describe("appShell", () => {
  const SHELL = "/index.html";
  const navigation = new Request("https://app.test/reports/3");

  it("answers a navigation with the cached shell, not with the navigated URL", async () => {
    // The point of the indirection: nothing is cached under `/reports/3`, and
    // matching the request would miss on every route but the root.
    // Seeded under the same relative URL the strategy matches on, which is how
    // a real worker stores it: `cache.put("/index.html")` resolves against the
    // worker's own location.
    const cache = createFakeCache({ [SHELL]: new Response("<!doctype html>") });
    const result = await appShell({
      cache,
      request: navigation,
      fetch: () => Promise.reject(new Error("offline")),
      shellUrl: SHELL,
    });
    expect(result.source).toBe("cache");
    expect(await result.response.text()).toBe("<!doctype html>");
  });

  it("falls back to the network before the precache has filled", async () => {
    const result = await appShell({
      cache: createFakeCache(),
      request: navigation,
      fetch: () => Promise.resolve(new Response("<!doctype html>from network")),
      shellUrl: SHELL,
    });
    expect(result.source).toBe("network");
  });

  it("returns a 503 when there is no shell and no network", async () => {
    const result = await appShell({
      cache: createFakeCache(),
      request: navigation,
      fetch: () => Promise.reject(new Error("offline")),
      shellUrl: SHELL,
    });
    expect(result.source).toBe("offline");
    expect(result.response.status).toBe(503);
  });
});

describe("trimCache", () => {
  it("evicts the oldest entries past the limit", async () => {
    const cache = createFakeCache();
    for (const n of [1, 2, 3, 4, 5]) await cache.put(`https://app.test/${n}`, new Response(`${n}`));

    expect(await trimCache(cache, 3)).toBe(2);
    expect(cache.urls()).toEqual([
      "https://app.test/3",
      "https://app.test/4",
      "https://app.test/5",
    ]);
  });

  it("does nothing under the limit", async () => {
    const cache = createFakeCache({ "https://app.test/1": new Response("1") });
    expect(await trimCache(cache, 3)).toBe(0);
    expect(cache.size()).toBe(1);
  });
});

describe("offlineResponse", () => {
  it("is a 503 the application can read rather than a thrown error", async () => {
    // A rejected `respondWith` renders the browser's own error page, which
    // replaces the running application with chrome that explains nothing.
    const response = offlineResponse(new Request(URL_A));
    expect(response.status).toBe(503);
    expect(response.headers.get("x-offline")).toBe("1");
    expect(await response.json()).toMatchObject({ error: "offline", url: URL_A });
  });
});
