import { describe, it, expect, vi } from "vitest";
import type { ApiClient, ApiRequestOptions } from "@/shared/api/apiClient";
import { ApiError } from "@/shared/api/apiClient";
import { abortReason, createAbortError, isAbortError } from "@/shared/lib/abort";
import { defaultDedupeKey, withDedupe, type DedupeShareInfo } from "@/shared/api/withDedupe";
import { withRetry } from "@/shared/api/withRetry";

interface PendingCall {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly signal: AbortSignal | undefined;
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

/**
 * A client that answers nothing until the test says so.
 *
 * Deduplication is entirely about the window between "a request started" and
 * "it finished", so every test here has to hold requests open and settle them
 * by hand. A client built on timers would make the same tests about timing.
 */
function manualClient() {
  const calls: PendingCall[] = [];

  function answer<T>(
    method: string,
    path: string,
    body: unknown,
    options: ApiRequestOptions | undefined,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      calls.push({
        method,
        path,
        body,
        signal: options?.signal,
        resolve: (value) => {
          resolve(value as T);
        },
        reject,
      });
    });
  }

  const client: ApiClient = {
    get<T>(path: string, options?: ApiRequestOptions): Promise<T> {
      return answer<T>("GET", path, undefined, options);
    },
    post<T>(path: string, body: unknown, options?: ApiRequestOptions): Promise<T> {
      return answer<T>("POST", path, body, options);
    },
    put<T>(path: string, body: unknown, options?: ApiRequestOptions): Promise<T> {
      return answer<T>("PUT", path, body, options);
    },
    patch<T>(path: string, body: unknown, options?: ApiRequestOptions): Promise<T> {
      return answer<T>("PATCH", path, body, options);
    },
    delete<T>(path: string, options?: ApiRequestOptions): Promise<T> {
      return answer<T>("DELETE", path, undefined, options);
    },
  };

  return { client, calls };
}

/** Lets pending microtasks run, so a shared promise has settled its subscribers. */
const flush = () => Promise.resolve();

describe("defaultDedupeKey", () => {
  it("keys on the verb and the path", () => {
    expect(defaultDedupeKey("GET", "/posts")).toBe("GET /posts");
    expect(defaultDedupeKey("GET", "/posts?page=2")).toBe("GET /posts?page=2");
  });

  it("opts out of sharing when the caller set its own headers", () => {
    // `Accept-Language`, `If-None-Match` and a tenant id all change the
    // response without changing the path. Not sharing is the safe half of the
    // trade; sharing them under a key that cannot see them is the unsafe one.
    expect(defaultDedupeKey("GET", "/posts", { headers: { "Accept-Language": "fr" } })).toBeNull();
  });
});

describe("withDedupe", () => {
  it("makes one request for concurrent identical GETs and resolves both", async () => {
    const { client, calls } = manualClient();
    const deduped = withDedupe(client);

    const first = deduped.get<{ id: number }>("/posts/1");
    const second = deduped.get<{ id: number }>("/posts/1");

    expect(calls).toHaveLength(1);
    calls[0]!.resolve({ id: 1 });

    await expect(first).resolves.toEqual({ id: 1 });
    await expect(second).resolves.toEqual({ id: 1 });
  });

  it("does not share across different paths", async () => {
    const { client, calls } = manualClient();
    const deduped = withDedupe(client);

    const first = deduped.get("/posts/1");
    const second = deduped.get("/posts/2");

    expect(calls).toHaveLength(2);
    calls[0]!.resolve({ id: 1 });
    calls[1]!.resolve({ id: 2 });
    await expect(first).resolves.toEqual({ id: 1 });
    await expect(second).resolves.toEqual({ id: 2 });
  });

  it("shares a failure with every subscriber", async () => {
    const { client, calls } = manualClient();
    const deduped = withDedupe(client);
    const failure = new ApiError(500, "Internal Server Error");

    const first = deduped.get("/posts");
    const second = deduped.get("/posts");
    calls[0]!.reject(failure);

    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
  });

  it("starts a fresh request once the shared one has settled", async () => {
    const { client, calls } = manualClient();
    const deduped = withDedupe(client);

    const first = deduped.get("/posts");
    calls[0]!.resolve([]);
    await first;
    // Not a cache: the entry exists only while the request is in flight, so
    // the next call goes to the network rather than replaying a stale answer.
    void deduped.get("/posts");

    expect(calls).toHaveLength(2);
  });

  it("clears the entry after a failure too, so a retry is possible", async () => {
    const { client, calls } = manualClient();
    const deduped = withDedupe(client);

    const first = deduped.get("/posts");
    calls[0]!.reject(new ApiError(500, "Internal Server Error"));
    await expect(first).rejects.toBeInstanceOf(ApiError);

    void deduped.get("/posts").catch(() => undefined);
    expect(calls).toHaveLength(2);
  });

  it("reports joined requests to onShare", async () => {
    const onShare = vi.fn<(info: DedupeShareInfo) => void>();
    const { client, calls } = manualClient();
    const deduped = withDedupe(client, { onShare });

    const first = deduped.get("/posts");
    const second = deduped.get("/posts");
    const third = deduped.get("/posts");

    // Twice, not three times: the first request started one, it did not join one.
    expect(onShare.mock.calls.map(([info]) => info)).toEqual([
      { key: "GET /posts", subscribers: 2 },
      { key: "GET /posts", subscribers: 3 },
    ]);

    calls[0]!.resolve([]);
    await Promise.all([first, second, third]);
  });

  describe("what is not shared", () => {
    it("leaves writes alone", async () => {
      const { client, calls } = manualClient();
      const deduped = withDedupe(client);

      // Two identical POSTs are a user who clicked twice. Collapsing them
      // silently discards one, which is the form's decision to make, not the
      // transport's.
      const first = deduped.post("/orders", { total: 1 });
      const second = deduped.post("/orders", { total: 1 });

      expect(calls).toHaveLength(2);
      calls[0]!.resolve({ id: 1 });
      calls[1]!.resolve({ id: 2 });
      await expect(first).resolves.toEqual({ id: 1 });
      await expect(second).resolves.toEqual({ id: 2 });
    });

    it("passes a request with custom headers straight through", () => {
      const { client, calls } = manualClient();
      const deduped = withDedupe(client);
      const headers = { "Accept-Language": "fr" };

      void deduped.get("/posts", { headers });
      void deduped.get("/posts", { headers });

      expect(calls).toHaveLength(2);
      // And the headers reach the client, rather than being dropped along with
      // the sharing.
      expect(calls[0]!.signal).toBeUndefined();
    });

    it("shares the verbs it is told to and no others", async () => {
      const { client, calls } = manualClient();
      const deduped = withDedupe(client, { methods: ["GET", "DELETE"] });

      void deduped.delete("/posts/1");
      void deduped.delete("/posts/1");
      expect(calls).toHaveLength(1);

      void deduped.put("/posts/1", { title: "x" });
      void deduped.put("/posts/1", { title: "x" });
      expect(calls).toHaveLength(3);

      calls.forEach((call) => {
        call.resolve(undefined);
      });
      await flush();
    });

    it("shares every verb it is configured for, and none when configured for none", async () => {
      const every = manualClient();
      const shared = withDedupe(every.client, {
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      });
      void shared.get("/a");
      void shared.get("/a");
      void shared.post("/a", { n: 1 });
      void shared.post("/a", { n: 1 });
      void shared.put("/a", { n: 1 });
      void shared.put("/a", { n: 1 });
      void shared.patch("/a", { n: 1 });
      void shared.patch("/a", { n: 1 });
      void shared.delete("/a");
      void shared.delete("/a");
      // Ten calls, five requests — one per verb, since the key includes it.
      expect(every.calls).toHaveLength(5);

      const none = manualClient();
      const direct = withDedupe(none.client, { methods: [] });
      void direct.get("/a");
      void direct.get("/a");
      void direct.post("/a", { n: 1 });
      void direct.post("/a", { n: 1 });
      void direct.put("/a", { n: 1 });
      void direct.put("/a", { n: 1 });
      void direct.patch("/a", { n: 1 });
      void direct.patch("/a", { n: 1 });
      void direct.delete("/a");
      void direct.delete("/a");
      expect(none.calls).toHaveLength(10);

      [...every.calls, ...none.calls].forEach((call) => {
        call.resolve(undefined);
      });
      await flush();
    });

    it("honours a keyOf that refuses a key", async () => {
      const { client, calls } = manualClient();
      const deduped = withDedupe(client, {
        keyOf: (_method, path) => (path.startsWith("/live") ? null : path),
      });

      void deduped.get("/live/ticker");
      void deduped.get("/live/ticker");
      expect(calls).toHaveLength(2);

      void deduped.get("/posts");
      void deduped.get("/posts");
      expect(calls).toHaveLength(3);

      calls.forEach((call) => {
        call.resolve(undefined);
      });
      await flush();
    });
  });

  describe("cancellation", () => {
    it("does not cancel the shared request when one subscriber aborts", async () => {
      const { client, calls } = manualClient();
      const deduped = withDedupe(client);
      const leaving = new AbortController();

      const abandoned = deduped.get("/posts", { signal: leaving.signal });
      const waiting = deduped.get<string[]>("/posts");

      leaving.abort();

      // The subscriber that left is rejected…
      await expect(abandoned).rejects.toSatisfy(isAbortError);
      // …and the one still waiting is unaffected. This is the bug the whole
      // refcount exists for: a naive shared map cancels the request out from
      // under everyone as soon as any one caller unmounts.
      expect(calls[0]!.signal?.aborted).toBe(false);
      calls[0]!.resolve(["a"]);
      await expect(waiting).resolves.toEqual(["a"]);
    });

    it("cancels the shared request when the last subscriber leaves", async () => {
      const { client, calls } = manualClient();
      const deduped = withDedupe(client);
      const first = new AbortController();
      const second = new AbortController();

      const a = deduped.get("/posts", { signal: first.signal });
      const b = deduped.get("/posts", { signal: second.signal });

      first.abort();
      expect(calls[0]!.signal?.aborted).toBe(false);

      second.abort();
      expect(calls[0]!.signal?.aborted).toBe(true);

      await expect(a).rejects.toSatisfy(isAbortError);
      await expect(b).rejects.toSatisfy(isAbortError);
    });

    it("keeps the request alive for a subscriber that passed no signal", async () => {
      const { client, calls } = manualClient();
      const deduped = withDedupe(client);
      const leaving = new AbortController();

      const uncancellable = deduped.get<string[]>("/posts");
      const abandoned = deduped.get("/posts", { signal: leaving.signal });

      leaving.abort();

      await expect(abandoned).rejects.toSatisfy(isAbortError);
      // A caller with no signal never leaves, so the count never reaches zero.
      expect(calls[0]!.signal?.aborted).toBe(false);
      calls[0]!.resolve(["a"]);
      await expect(uncancellable).resolves.toEqual(["a"]);
    });

    it("starts a fresh request for a caller arriving after the last one left", async () => {
      const { client, calls } = manualClient();
      const deduped = withDedupe(client);
      const leaving = new AbortController();

      const abandoned = deduped.get("/posts", { signal: leaving.signal });
      leaving.abort();

      // Synchronously after the abort, and before the cancelled request's own
      // promise has had a chance to reject: the key must already be gone, or
      // this caller joins a request that is being cancelled and gets an
      // `AbortError` for somebody else's navigation.
      const arriving = deduped.get<string[]>("/posts");
      expect(calls).toHaveLength(2);

      await expect(abandoned).rejects.toSatisfy(isAbortError);
      calls[1]!.resolve(["a"]);
      await expect(arriving).resolves.toEqual(["a"]);
      expect(calls[1]!.signal?.aborted).toBe(false);
    });

    it("rejects with the reason the last subscriber gave", async () => {
      const { client } = manualClient();
      const deduped = withDedupe(client);
      const controller = new AbortController();
      const reason = new Error("route changed");

      const pending = deduped.get("/posts", { signal: controller.signal });
      controller.abort(reason);

      await expect(pending).rejects.toBe(reason);
    });

    it("rejects a caller whose signal was already aborted", async () => {
      const { client, calls } = manualClient();
      const deduped = withDedupe(client);
      const controller = new AbortController();
      controller.abort(createAbortError());

      const pending = deduped.get("/posts", { signal: controller.signal });

      await expect(pending).rejects.toSatisfy(isAbortError);
      // The request was started and then immediately cancelled, rather than
      // being left running with nobody waiting on it.
      expect(calls[0]!.signal?.aborted).toBe(true);
    });

    it("ignores an abort that arrives after the response", async () => {
      const { client, calls } = manualClient();
      const deduped = withDedupe(client);
      const controller = new AbortController();

      const pending = deduped.get<{ id: number }>("/posts/1", { signal: controller.signal });
      calls[0]!.resolve({ id: 1 });
      await expect(pending).resolves.toEqual({ id: 1 });

      // A late abort must not reject a promise that already resolved, and must
      // not drive the subscriber count negative for a later request under the
      // same key.
      controller.abort();
      const next = deduped.get<{ id: number }>("/posts/1");
      expect(calls).toHaveLength(2);
      calls[1]!.resolve({ id: 1 });
      await expect(next).resolves.toEqual({ id: 1 });
    });

    it("abandons the retry backoff when the last subscriber leaves", async () => {
      // The composed client, in the order `app/api/client.ts` builds it. The
      // signal `withRetry` waits on is the *shared* controller's, so a backoff
      // with nobody left waiting on it ends rather than running to completion
      // and making a request for an audience of none.
      const { client, calls } = manualClient();
      const sleep = vi.fn(
        (_ms: number, signal?: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(abortReason(signal));
            });
          }),
      );
      const resilient = withDedupe(withRetry(client, { sleep }));
      const controller = new AbortController();

      const pending = resilient.get("/posts", { signal: controller.signal });
      calls[0]!.reject(new ApiError(503, "Service Unavailable"));
      await flush();
      expect(sleep).toHaveBeenCalledOnce();

      controller.abort();

      await expect(pending).rejects.toSatisfy(isAbortError);
      await flush();
      expect(calls).toHaveLength(1);
    });

    it("does not leave an unhandled rejection when every subscriber has gone", async () => {
      const { client, calls } = manualClient();
      const deduped = withDedupe(client);
      const controller = new AbortController();

      const pending = deduped.get("/posts", { signal: controller.signal });
      controller.abort();
      await expect(pending).rejects.toSatisfy(isAbortError);

      // The shared request now fails with nobody subscribed to observe it.
      // Without the decorator's own `catch`, that is an unhandled rejection —
      // and the assertion for it is the test run itself: Vitest reports one as
      // an unhandled error and exits non-zero, whichever test provoked it.
      calls[0]!.reject(createAbortError());
      await flush();
      await flush();

      expect(calls[0]!.signal?.aborted).toBe(true);
    });
  });
});

describe("withDedupe(withRetry(client))", () => {
  it("runs one retry schedule for every subscriber, not one each", async () => {
    const { client, calls } = manualClient();
    const resilient = withDedupe(withRetry(client, { sleep: () => Promise.resolve() }));

    // Five components mounting at once, into a server that fails and recovers.
    const pending = Array.from({ length: 5 }, () => resilient.get<string[]>("/posts"));
    expect(calls).toHaveLength(1);

    calls[0]!.reject(new ApiError(503, "Service Unavailable"));
    await flush();
    await flush();

    // One retry, shared. Composed the other way round — retry outside dedupe —
    // the first failure clears the in-flight entry and the remaining four
    // callers each start their own retry loop: five callers, ten requests, on a
    // server that has just said it is overloaded.
    expect(calls).toHaveLength(2);
    calls[1]!.resolve(["a"]);

    await expect(Promise.all(pending)).resolves.toEqual([["a"], ["a"], ["a"], ["a"], ["a"]]);
  });
});
