import { describe, it, expect, vi } from "vitest";
import { ApiError } from "@/shared/api/apiClient";
import { StubRouteNotFoundError, createStubApiClient } from "@/shared/api/createStubApiClient";

describe("createStubApiClient", () => {
  it("answers a route with its canned value", async () => {
    const client = createStubApiClient({ routes: { "GET /posts": [{ id: 1 }] } });
    await expect(client.get("/posts")).resolves.toEqual([{ id: 1 }]);
  });

  it("passes the call to a function route, including the request body", async () => {
    const client = createStubApiClient({
      routes: { "POST /posts": (call) => ({ echoed: call.body, path: call.path }) },
    });

    await expect(client.post("/posts", { title: "hi" })).resolves.toEqual({
      echoed: { title: "hi" },
      path: "/posts",
    });
  });

  it("awaits a promise returned by a route", async () => {
    const client = createStubApiClient({
      routes: { "GET /slow": () => Promise.resolve({ done: true }) },
    });
    await expect(client.get("/slow")).resolves.toEqual({ done: true });
  });

  it("surfaces an ApiError thrown by a route, so error paths are reachable", async () => {
    const client = createStubApiClient({
      routes: {
        "GET /boom": () => {
          throw new ApiError(500, "Internal Server Error");
        },
      },
    });

    await expect(client.get("/boom")).rejects.toBeInstanceOf(ApiError);
  });

  it("throws a StubRouteNotFoundError naming the key and the routes it does have", async () => {
    const client = createStubApiClient({ routes: { "GET /posts": [] } });

    const error = await client.get("/comments").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StubRouteNotFoundError);
    expect((error as Error).message).toContain("GET /comments");
    expect((error as Error).message).toContain("GET /posts");
  });

  it("says so plainly when it has no routes at all", async () => {
    // The default in renderWithProviders. "No stub route for X, and this stub
    // has none" is a different mistake from "you stubbed the wrong path".
    const error = await createStubApiClient()
      .get("/anything")
      .catch((e: unknown) => e);
    expect((error as Error).message).toContain("no routes at all");
  });

  it("matches method and path exactly rather than by pattern", async () => {
    const client = createStubApiClient({ routes: { "GET /posts": [] } });
    await expect(client.post("/posts", {})).rejects.toBeInstanceOf(StubRouteNotFoundError);
    await expect(client.get("/posts/1")).rejects.toBeInstanceOf(StubRouteNotFoundError);
  });

  it("records every call in order, including the ones that had no route", async () => {
    const client = createStubApiClient({ routes: { "GET /posts": [] } });

    await client.get("/posts");
    await client.delete("/posts/1").catch(() => undefined);
    await client.patch("/posts/2", { done: true }).catch(() => undefined);

    expect(client.calls).toEqual([
      { method: "GET", path: "/posts" },
      { method: "DELETE", path: "/posts/1" },
      { method: "PATCH", path: "/posts/2", body: { done: true } },
    ]);
  });

  it("hands out a copy of the call log, so a caller cannot edit the record", async () => {
    const client = createStubApiClient({ routes: { "GET /posts": [] } });
    await client.get("/posts");

    const snapshot = client.calls;
    (snapshot as { length: number }).length = 0;

    expect(client.calls).toHaveLength(1);
  });

  it("drops recorded calls on reset while keeping the routes", async () => {
    const client = createStubApiClient({ routes: { "GET /posts": [] } });
    await client.get("/posts");
    client.reset();

    expect(client.calls).toEqual([]);
    await expect(client.get("/posts")).resolves.toEqual([]);
  });

  it("notifies onRequest as each call is made", async () => {
    const onRequest = vi.fn();
    const client = createStubApiClient({ routes: { "GET /posts": [] }, onRequest });

    await client.get("/posts");

    expect(onRequest).toHaveBeenCalledExactlyOnceWith({ method: "GET", path: "/posts" });
  });

  it("settles on a microtask at zero latency, so fake timers need not be advanced", async () => {
    vi.useFakeTimers();
    try {
      const client = createStubApiClient({ routes: { "GET /posts": [] } });
      // No timer is advanced anywhere in this test. A stub built on
      // setTimeout(0) would hang here instead.
      await expect(client.get("/posts")).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for the requested latency when one is set", async () => {
    vi.useFakeTimers();
    try {
      const client = createStubApiClient({ routes: { "GET /posts": [] }, latencyMs: 500 });
      const settled = vi.fn();
      const pending = client.get("/posts").then(settled);

      await vi.advanceTimersByTimeAsync(499);
      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(settled).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
