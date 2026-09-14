import { describe, it, expect } from "vitest";
import { describeRequest, routeRequest, type RequestFacts } from "@/shared/offline/routing";

const ORIGIN = "https://app.test";
const CONFIG = {
  origin: ORIGIN,
  precachedPaths: new Set(["/index.html", "/assets/index-a1b2c3.js"]),
};

function facts(overrides: Partial<RequestFacts> & Pick<RequestFacts, "url">): RequestFacts {
  return {
    method: "GET",
    mode: "cors",
    destination: "",
    ranged: false,
    ...overrides,
  };
}

describe("routeRequest", () => {
  it("queues a same-origin API write", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(routeRequest(facts({ url: `${ORIGIN}/api/posts`, method }), CONFIG)).toBe(
        "queue-write",
      );
    }
  });

  it("does not queue a write to a third party", () => {
    // Someone else's API is someone else's retry policy. Queuing it would
    // replay a request this application cannot reason about — and would do it
    // with an idempotency header that endpoint never agreed to honour.
    expect(
      routeRequest(facts({ url: "https://analytics.test/collect", method: "POST" }), CONFIG),
    ).toBe("passthrough");
  });

  it("does not queue a write outside the API prefix", () => {
    expect(routeRequest(facts({ url: `${ORIGIN}/upload`, method: "POST" }), CONFIG)).toBe(
      "passthrough",
    );
  });

  it("serves the app shell for a navigation", () => {
    expect(
      routeRequest(
        facts({ url: `${ORIGIN}/reports/3`, mode: "navigate", destination: "document" }),
        CONFIG,
      ),
    ).toBe("app-shell");
  });

  it("serves the app shell when only `destination` says it is a document", () => {
    // Safari reported `mode: "cors"` for the main resource for years; the
    // fallback is what keeps the shell reachable there.
    expect(
      routeRequest(facts({ url: `${ORIGIN}/reports/3`, destination: "document" }), CONFIG),
    ).toBe("app-shell");
  });

  it("serves a precached asset cache-first", () => {
    expect(
      routeRequest(
        facts({ url: `${ORIGIN}/assets/index-a1b2c3.js`, destination: "script" }),
        CONFIG,
      ),
    ).toBe("precached-asset");
  });

  it("revalidates a lazy chunk that is not in the precache", () => {
    // Route chunks are deliberately left out of the precache — see
    // `tooling/serviceWorker/precacheManifest.ts`. They are cached on first
    // visit by the runtime strategy instead.
    expect(
      routeRequest(
        facts({ url: `${ORIGIN}/assets/ReportsPage-9f8e7d.js`, destination: "script" }),
        CONFIG,
      ),
    ).toBe("runtime-cache");
  });

  it("revalidates an API read", () => {
    expect(routeRequest(facts({ url: `${ORIGIN}/api/posts?page=2` }), CONFIG)).toBe(
      "runtime-cache",
    );
  });

  it("leaves cross-origin reads to the browser", () => {
    // A cross-origin GET with no CORS yields an opaque response: status 0,
    // unreadable, and padded to a multiple of 32MB against the origin quota.
    expect(routeRequest(facts({ url: "https://cdn.test/font.woff2" }), CONFIG)).toBe("passthrough");
  });

  it("leaves range requests to the browser", () => {
    // `Cache.put` rejects a 206, and answering from a whole cached body
    // returns more than was asked for.
    expect(routeRequest(facts({ url: `${ORIGIN}/media/clip.mp4`, ranged: true }), CONFIG)).toBe(
      "passthrough",
    );
  });

  it("leaves HEAD to the browser", () => {
    expect(routeRequest(facts({ url: `${ORIGIN}/api/posts`, method: "HEAD" }), CONFIG)).toBe(
      "passthrough",
    );
  });

  it("passes through a URL it cannot parse", () => {
    expect(routeRequest(facts({ url: "not a url" }), CONFIG)).toBe("passthrough");
  });
});

describe("describeRequest", () => {
  it("reads the routing-relevant parts of a request", () => {
    const request = new Request(`${ORIGIN}/api/posts`, {
      method: "POST",
      headers: { range: "bytes=0-99" },
      body: "{}",
    });
    expect(describeRequest(request)).toEqual({
      url: `${ORIGIN}/api/posts`,
      method: "POST",
      mode: request.mode,
      destination: request.destination,
      ranged: true,
    });
  });

  it("reports no range header when there is none", () => {
    expect(describeRequest(new Request(`${ORIGIN}/api/posts`)).ranged).toBe(false);
  });
});
