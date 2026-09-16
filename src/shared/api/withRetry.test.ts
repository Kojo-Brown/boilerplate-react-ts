import { describe, it, expect, vi } from "vitest";
import { ApiError, type ApiClient, type ApiRequestOptions } from "@/shared/api/apiClient";
import { createAbortError, isAbortError } from "@/shared/lib/abort";
import { isRetryableStatus, isTransientError, withRetry } from "@/shared/api/withRetry";

/**
 * A client whose every verb answers from a queue of outcomes.
 *
 * An outcome is a value to resolve with or an error to reject with; `Error`
 * instances are thrown, everything else is returned. That is enough to script
 * "fails twice then succeeds" in one line, which is the shape of almost every
 * test here.
 */
function scriptedClient(...outcomes: unknown[]) {
  const calls: { method: string; path: string; signal: AbortSignal | undefined }[] = [];
  let index = 0;

  function answer<T>(method: string, path: string, signal: AbortSignal | undefined): Promise<T> {
    calls.push({ method, path, signal });
    // The last outcome repeats, so "always fails" is one argument rather than
    // one per attempt.
    const outcome = outcomes[Math.min(index, outcomes.length - 1)];
    index += 1;
    // `isAbortError` as well as `instanceof Error`: jsdom's `DOMException` does
    // not inherit from `Error`, so a cancellation scripted here would otherwise
    // be *resolved* with rather than thrown — which is a test that passes for
    // the wrong reason.
    if (outcome instanceof Error || isAbortError(outcome)) return Promise.reject(outcome);
    return Promise.resolve(outcome as T);
  }

  const client: ApiClient = {
    get<T>(path: string, options?: ApiRequestOptions): Promise<T> {
      return answer<T>("GET", path, options?.signal);
    },
    post<T>(path: string, _body: unknown, options?: ApiRequestOptions): Promise<T> {
      return answer<T>("POST", path, options?.signal);
    },
    put<T>(path: string, _body: unknown, options?: ApiRequestOptions): Promise<T> {
      return answer<T>("PUT", path, options?.signal);
    },
    patch<T>(path: string, _body: unknown, options?: ApiRequestOptions): Promise<T> {
      return answer<T>("PATCH", path, options?.signal);
    },
    delete<T>(path: string, options?: ApiRequestOptions): Promise<T> {
      return answer<T>("DELETE", path, options?.signal);
    },
  };

  return { client, calls };
}

/** Every test that is not about timing injects this, so none of them wait. */
const immediate = () => Promise.resolve();

/** The midpoint draw, so a jittered delay is exactly half its ceiling. */
const midpoint = () => 0.5;

function serverError(status = 503, headers?: HeadersInit): ApiError {
  return new ApiError(
    status,
    "Service Unavailable",
    undefined,
    headers === undefined ? undefined : new Headers(headers),
  );
}

describe("isRetryableStatus", () => {
  it("accepts the statuses that mean 'again, later'", () => {
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(425)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });

  it("rejects the statuses that will fail identically forever", () => {
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(422)).toBe(false);
  });
});

describe("isTransientError", () => {
  it("retries a network failure", () => {
    // What `fetch` rejects with when the request never reached a server.
    expect(isTransientError(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("never retries a cancellation", () => {
    // The caller asked for this to stop. Retrying is the one response that
    // ignores them — and an AbortError is not a failure of the server's.
    expect(isTransientError(createAbortError())).toBe(false);
  });

  it("follows the status for an ApiError", () => {
    expect(isTransientError(new ApiError(500, "Internal Server Error"))).toBe(true);
    expect(isTransientError(new ApiError(404, "Not Found"))).toBe(false);
  });

  it("does not retry a plain Error", () => {
    expect(isTransientError(new Error("parse failed"))).toBe(false);
    expect(isTransientError("nope")).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns the first successful response without retrying", async () => {
    const { client, calls } = scriptedClient({ id: 1 });
    const retrying = withRetry(client, { sleep: immediate });

    await expect(retrying.get<{ id: number }>("/posts/1")).resolves.toEqual({ id: 1 });
    expect(calls).toHaveLength(1);
  });

  it("retries a transient failure and resolves with the attempt that works", async () => {
    const { client, calls } = scriptedClient(serverError(), serverError(), { id: 1 });
    const retrying = withRetry(client, { sleep: immediate });

    await expect(retrying.get<{ id: number }>("/posts/1")).resolves.toEqual({ id: 1 });
    expect(calls).toHaveLength(3);
  });

  it("gives up after maxRetries and throws the last error", async () => {
    const last = serverError(500);
    const { client, calls } = scriptedClient(serverError(), serverError(), serverError(), last);
    const retrying = withRetry(client, { sleep: immediate, maxRetries: 3 });

    await expect(retrying.get("/posts")).rejects.toBe(last);
    // 1 original + 3 retries. The error that surfaces is the last one seen,
    // not the first: it is the most recent evidence about the server.
    expect(calls).toHaveLength(4);
  });

  it("does not retry a 4xx", async () => {
    const notFound = new ApiError(404, "Not Found");
    const { client, calls } = scriptedClient(notFound);
    const retrying = withRetry(client, { sleep: immediate });

    await expect(retrying.get("/posts/999")).rejects.toBe(notFound);
    expect(calls).toHaveLength(1);
  });

  it("waits on the jittered schedule between attempts", async () => {
    const sleep = vi.fn<(ms: number, signal?: AbortSignal) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const { client } = scriptedClient(serverError(), serverError(), serverError(), { ok: true });
    const retrying = withRetry(client, {
      sleep,
      random: midpoint,
      backoff: { baseDelayMs: 100, maxDelayMs: 10_000 },
    });

    await retrying.get("/posts");

    // Half of 100, 200, 400 — the midpoint of each doubling interval.
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([50, 100, 200]);
  });

  it("reports each retry before it waits", async () => {
    const onRetry = vi.fn();
    const failure = serverError();
    const { client } = scriptedClient(failure, { ok: true });
    const retrying = withRetry(client, { sleep: immediate, random: midpoint, onRetry });

    await retrying.get("/posts");

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledWith({
      method: "GET",
      path: "/posts",
      attempt: 1,
      delayMs: 125,
      error: failure,
    });
  });

  describe("idempotency", () => {
    it("retries GET, PUT and DELETE", async () => {
      for (const verb of ["get", "put", "delete"] as const) {
        const { client, calls } = scriptedClient(serverError(), { ok: true });
        const retrying = withRetry(client, { sleep: immediate });
        await (verb === "put"
          ? retrying.put("/tasks/1", { title: "x" })
          : retrying[verb]("/tasks/1"));
        expect(calls).toHaveLength(2);
      }
    });

    it("does not retry POST or PATCH, whose repeat is a second write", async () => {
      for (const verb of ["post", "patch"] as const) {
        const failure = serverError();
        const { client, calls } = scriptedClient(failure, { ok: true });
        const retrying = withRetry(client, { sleep: immediate });
        await expect(retrying[verb]("/orders", { total: 1 })).rejects.toBe(failure);
        expect(calls).toHaveLength(1);
      }
    });

    it("lets an endpoint with an idempotency key opt POST in", async () => {
      const { client, calls } = scriptedClient(serverError(), { ok: true });
      const retrying = withRetry(client, { sleep: immediate, methods: ["POST"] });

      await expect(retrying.post("/orders", { total: 1 })).resolves.toEqual({ ok: true });
      expect(calls).toHaveLength(2);
    });
  });

  describe("Retry-After", () => {
    it("obeys the server's delay over its own schedule", async () => {
      const sleep = vi.fn<(ms: number, signal?: AbortSignal) => Promise<void>>(() =>
        Promise.resolve(),
      );
      const { client } = scriptedClient(serverError(429, { "retry-after": "2" }), { ok: true });
      const retrying = withRetry(client, { sleep, random: midpoint });

      await retrying.get("/posts");

      expect(sleep).toHaveBeenCalledWith(2_000, undefined);
    });

    it("gives up rather than holding a request open for a long one", async () => {
      const throttled = serverError(429, { "retry-after": "3600" });
      const { client, calls } = scriptedClient(throttled);
      const retrying = withRetry(client, { sleep: immediate, maxRetryAfterMs: 30_000 });

      await expect(retrying.get("/posts")).rejects.toBe(throttled);
      // An hour behind a spinner is not a retry, it is a hang. The error
      // reaches the user, who can do something about it.
      expect(calls).toHaveLength(1);
    });

    it("falls back to the local schedule when the header is unparseable", async () => {
      const sleep = vi.fn<(ms: number, signal?: AbortSignal) => Promise<void>>(() =>
        Promise.resolve(),
      );
      const { client } = scriptedClient(serverError(503, { "retry-after": "whenever" }), {
        ok: true,
      });
      const retrying = withRetry(client, { sleep, random: midpoint });

      await retrying.get("/posts");

      expect(sleep).toHaveBeenCalledWith(125, undefined);
    });

    it("resolves an HTTP date against the injected clock", async () => {
      const now = Date.UTC(2026, 8, 16, 12, 0, 0);
      const sleep = vi.fn<(ms: number, signal?: AbortSignal) => Promise<void>>(() =>
        Promise.resolve(),
      );
      const at = new Date(now + 5_000).toUTCString();
      const { client } = scriptedClient(serverError(503, { "retry-after": at }), { ok: true });
      const retrying = withRetry(client, { sleep, now: () => now });

      await retrying.get("/posts");

      expect(sleep).toHaveBeenCalledWith(5_000, undefined);
    });
  });

  describe("cancellation", () => {
    it("never retries a cancelled request", async () => {
      const controller = new AbortController();
      const aborted = createAbortError();
      const { client, calls } = scriptedClient(aborted);
      const retrying = withRetry(client, { sleep: immediate });

      await expect(retrying.get("/posts", { signal: controller.signal })).rejects.toBe(aborted);
      expect(calls).toHaveLength(1);
    });

    it("hands the caller's signal to the wait, so a backoff is abandoned", async () => {
      const sleep = vi.fn<(ms: number, signal?: AbortSignal) => Promise<void>>(() =>
        Promise.resolve(),
      );
      const controller = new AbortController();
      const { client } = scriptedClient(serverError(), { ok: true });
      const retrying = withRetry(client, { sleep, random: midpoint });

      await retrying.get("/posts", { signal: controller.signal });

      expect(sleep).toHaveBeenCalledWith(125, controller.signal);
    });

    it("stops mid-backoff when the caller aborts, rather than making the retry", async () => {
      vi.useFakeTimers();
      try {
        const controller = new AbortController();
        const reason = new Error("navigated away");
        const { client, calls } = scriptedClient(serverError(), { ok: true });
        // The real abortable sleep, so this exercises the wiring rather than a
        // double: 8 s of backoff, cancelled 10 ms in.
        const retrying = withRetry(client, {
          random: () => 1,
          backoff: { baseDelayMs: 8_000, maxDelayMs: 8_000 },
        });

        const pending = retrying.get("/posts", { signal: controller.signal });
        await vi.advanceTimersByTimeAsync(10);
        controller.abort(reason);

        await expect(pending).rejects.toBe(reason);
        // Still one call: the retry the backoff was waiting to make never
        // happened, which is the whole point of an abortable wait.
        expect(calls).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
