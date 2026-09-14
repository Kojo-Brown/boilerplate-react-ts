import { describe, it, expect, vi } from "vitest";
import { createMemoryQueueStore, type QueueStore } from "@/shared/offline/queueStore";
import {
  backoffMs,
  DEFAULT_REPLAY_POLICY,
  enqueueWrite,
  isRetryable,
  queuedResponse,
  replayQueue,
  retryAfterMs,
  toRequest,
  type ReplayPolicy,
} from "@/shared/offline/syncQueue";
import { IDEMPOTENCY_HEADER, QUEUED_HEADER } from "@/shared/offline/config";

const NOW = 1_700_000_000_000;

function write(url = "https://app.test/api/posts", body = '{"title":"hi"}'): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

async function seed(store: QueueStore, count: number, now = NOW): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await enqueueWrite(store, write(`https://app.test/api/posts/${index}`), now, {
      newId: () => `mock-idempotency-key-${index}`,
    });
  }
}

describe("enqueueWrite", () => {
  it("stores what a replay needs and nothing that cannot be cloned", async () => {
    const store = createMemoryQueueStore();
    const entry = await enqueueWrite(store, write(), NOW, { newId: () => "mock-key" });

    expect(entry).toMatchObject({
      url: "https://app.test/api/posts",
      method: "POST",
      queuedAt: NOW,
      attempts: 0,
      // Eligible immediately: the request failed once, which is not evidence
      // that the network is down for the next five seconds.
      nextAttemptAt: NOW,
    });
    // Header pairs rather than a `Headers`, which is not structured-cloneable
    // — storing one throws exactly when the user has just gone offline.
    expect(entry.headers).toContainEqual(["content-type", "application/json"]);
    expect(new TextDecoder().decode(entry.body ?? new ArrayBuffer(0))).toBe('{"title":"hi"}');
  });

  it("stamps an idempotency key once, at enqueue time", async () => {
    const store = createMemoryQueueStore();
    const entry = await enqueueWrite(store, write(), NOW, { newId: () => "mock-key" });
    expect(entry.headers).toContainEqual([IDEMPOTENCY_HEADER, "mock-key"]);
  });

  it("keeps a key the caller already chose", async () => {
    // The application may key on something meaningful — a draft id, a form
    // submission id — and overwriting it would defeat the deduplication it was
    // chosen for.
    const request = new Request("https://app.test/api/posts", {
      method: "POST",
      headers: { [IDEMPOTENCY_HEADER]: "caller-owned-key" },
      body: "{}",
    });
    const entry = await enqueueWrite(createMemoryQueueStore(), request, NOW, {
      newId: () => "mock-key",
    });
    expect(entry.headers.filter(([name]) => name === IDEMPOTENCY_HEADER)).toEqual([
      [IDEMPOTENCY_HEADER, "caller-owned-key"],
    ]);
  });

  it("leaves the caller's request readable", async () => {
    const request = write();
    await enqueueWrite(createMemoryQueueStore(), request, NOW);
    expect(request.bodyUsed).toBe(false);
  });

  it("stores no body for a request that has none", async () => {
    const request = new Request("https://app.test/api/posts/1", { method: "DELETE" });
    const entry = await enqueueWrite(createMemoryQueueStore(), request, NOW);
    expect(entry.body).toBeNull();
  });
});

describe("queuedResponse", () => {
  it("is a 202 that says it is queued rather than a 200 that says it is saved", async () => {
    const store = createMemoryQueueStore();
    const entry = await enqueueWrite(store, write(), NOW);
    const response = queuedResponse(entry);

    expect(response.status).toBe(202);
    expect(response.headers.get(QUEUED_HEADER)).toBe("1");
    expect(await response.json()).toEqual({ queued: true, id: entry.id, queuedAt: NOW });
  });
});

describe("toRequest", () => {
  it("rebuilds a request that can be sent again", async () => {
    const store = createMemoryQueueStore();
    const entry = await enqueueWrite(store, write(), NOW, { newId: () => "mock-key" });
    const request = toRequest(entry);

    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://app.test/api/posts");
    expect(request.headers.get(IDEMPOTENCY_HEADER)).toBe("mock-key");
    expect(await request.text()).toBe('{"title":"hi"}');
  });
});

describe("replayQueue", () => {
  const ok = (): Promise<Response> => Promise.resolve(new Response(null, { status: 204 }));

  it("sends everything, oldest first, and empties the queue", async () => {
    const store = createMemoryQueueStore();
    await seed(store, 3);
    const seen: string[] = [];

    const report = await replayQueue({
      store,
      now: NOW,
      fetch: (request) => {
        seen.push(request.url);
        return ok();
      },
    });

    expect(seen).toEqual([
      "https://app.test/api/posts/0",
      "https://app.test/api/posts/1",
      "https://app.test/api/posts/2",
    ]);
    expect(report.remaining).toBe(0);
    expect(report.outcomes.every((outcome) => outcome.kind === "sent")).toBe(true);
  });

  it("stops at the first network failure instead of burning every entry's attempts", async () => {
    const store = createMemoryQueueStore();
    await seed(store, 3);
    const fetchFn = vi.fn(() => Promise.reject(new Error("offline")));

    const report = await replayQueue({ store, now: NOW, fetch: fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(report.remaining).toBe(3);
    expect(report.outcomes).toEqual([
      { kind: "retry", id: 1, attempts: 1, nextAttemptAt: NOW + DEFAULT_REPLAY_POLICY.baseDelayMs },
    ]);
  });

  it("does not send an entry before its backoff has elapsed", async () => {
    const store = createMemoryQueueStore();
    await seed(store, 2);
    await replayQueue({ store, now: NOW, fetch: () => Promise.reject(new Error("offline")) });

    const fetchFn = vi.fn(ok);
    const report = await replayQueue({ store, now: NOW + 1_000, fetch: fetchFn });

    // Head-of-line blocking is the point: entry 2 is ready, and sending it
    // before entry 1 would produce a server state the client never had.
    expect(fetchFn).not.toHaveBeenCalled();
    expect(report.outcomes).toEqual([
      { kind: "deferred", id: 1, nextAttemptAt: NOW + DEFAULT_REPLAY_POLICY.baseDelayMs },
    ]);
  });

  it("backs off further on each failure", async () => {
    const store = createMemoryQueueStore();
    await seed(store, 1);
    const offline = (): Promise<Response> => Promise.reject(new Error("offline"));

    await replayQueue({ store, now: NOW, fetch: offline });
    const second = await replayQueue({ store, now: NOW + 60_000, fetch: offline });

    expect(second.outcomes[0]).toEqual({
      kind: "retry",
      id: 1,
      attempts: 2,
      nextAttemptAt: NOW + 60_000 + DEFAULT_REPLAY_POLICY.baseDelayMs * 2,
    });
  });

  it("gives up after the attempt limit", async () => {
    const policy: ReplayPolicy = { ...DEFAULT_REPLAY_POLICY, maxAttempts: 2 };
    const store = createMemoryQueueStore();
    await seed(store, 1);
    const offline = (): Promise<Response> => Promise.reject(new Error("offline"));

    await replayQueue({ store, now: NOW, fetch: offline, policy });
    const second = await replayQueue({ store, now: NOW + 600_000, fetch: offline, policy });

    // The user believed this was saved and it never was, which is why
    // `messages.ts` reports dropped writes separately from sent ones.
    expect(second.outcomes).toEqual([{ kind: "dropped", id: 1, reason: "exhausted" }]);
    expect(second.remaining).toBe(0);
  });

  it("drops a write the server refused and carries on with the next", async () => {
    const store = createMemoryQueueStore();
    await seed(store, 2);

    const report = await replayQueue({
      store,
      now: NOW,
      fetch: (request) =>
        request.url.endsWith("/0")
          ? Promise.resolve(new Response("bad request", { status: 422 }))
          : ok(),
    });

    // A 422 is not a connectivity problem. Retrying it is only a way to take
    // longer to tell the user the same thing.
    expect(report.outcomes).toEqual([
      { kind: "dropped", id: 1, reason: "rejected", status: 422 },
      { kind: "sent", id: 2, status: 204 },
    ]);
    expect(report.remaining).toBe(0);
  });

  it("retries a 503 rather than dropping it", async () => {
    const store = createMemoryQueueStore();
    await seed(store, 1);
    const report = await replayQueue({
      store,
      now: NOW,
      fetch: () => Promise.resolve(new Response("down", { status: 503 })),
    });
    expect(report.outcomes[0]).toMatchObject({ kind: "retry", attempts: 1 });
    expect(report.remaining).toBe(1);
  });

  it("obeys `Retry-After` over its own backoff", async () => {
    const store = createMemoryQueueStore();
    await seed(store, 1);
    const report = await replayQueue({
      store,
      now: NOW,
      fetch: () =>
        Promise.resolve(
          new Response("slow down", { status: 429, headers: { "retry-after": "120" } }),
        ),
    });
    // A server that says when to come back knows more than any local schedule.
    expect(report.outcomes[0]).toMatchObject({ kind: "retry", nextAttemptAt: NOW + 120_000 });
  });

  it("drops a write that has been waiting longer than the age limit", async () => {
    const store = createMemoryQueueStore();
    await seed(store, 1);
    const fetchFn = vi.fn(ok);

    const report = await replayQueue({
      store,
      now: NOW + DEFAULT_REPLAY_POLICY.maxAgeMs + 1,
      fetch: fetchFn,
    });

    // Sending a day-old write is its own failure mode: the token has expired,
    // the thread it belongs to may be gone, and the user has forgotten it.
    expect(fetchFn).not.toHaveBeenCalled();
    expect(report.outcomes).toEqual([{ kind: "dropped", id: 1, reason: "expired" }]);
  });

  it("reports an empty queue without calling the network", async () => {
    const fetchFn = vi.fn(ok);
    const report = await replayQueue({ store: createMemoryQueueStore(), now: NOW, fetch: fetchFn });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(report).toEqual({ outcomes: [], remaining: 0 });
  });
});

describe("backoffMs", () => {
  it("doubles per attempt", () => {
    expect(backoffMs(1)).toBe(5_000);
    expect(backoffMs(2)).toBe(10_000);
    expect(backoffMs(3)).toBe(20_000);
  });

  it("stops at the ceiling", () => {
    // Without a ceiling the fifth attempt lands after the user has closed the
    // tab, and the queue never drains while they are looking at it.
    expect(backoffMs(20)).toBe(DEFAULT_REPLAY_POLICY.maxDelayMs);
  });
});

describe("isRetryable", () => {
  it.each([408, 425, 429, 500, 503, 504])("retries %i", (status) => {
    expect(isRetryable(status)).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 422])("does not retry %i", (status) => {
    expect(isRetryable(status)).toBe(false);
  });
});

describe("retryAfterMs", () => {
  it("reads delta-seconds", () => {
    expect(retryAfterMs(new Response(null, { headers: { "retry-after": "30" } }), NOW)).toBe(
      30_000,
    );
  });

  it("reads an HTTP date", () => {
    const at = new Date(NOW + 45_000).toUTCString();
    // Second resolution: the date header cannot express the milliseconds.
    expect(retryAfterMs(new Response(null, { headers: { "retry-after": at } }), NOW)).toBeCloseTo(
      45_000,
      -3,
    );
  });

  it("clamps a date that has already passed", () => {
    const at = new Date(NOW - 60_000).toUTCString();
    expect(retryAfterMs(new Response(null, { headers: { "retry-after": at } }), NOW)).toBe(0);
  });

  it("ignores a header it cannot read", () => {
    expect(
      retryAfterMs(new Response(null, { headers: { "retry-after": "soon" } }), NOW),
    ).toBeUndefined();
  });

  it("is absent when the header is", () => {
    expect(retryAfterMs(new Response(null), NOW)).toBeUndefined();
  });
});
