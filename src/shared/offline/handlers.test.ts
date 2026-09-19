import { describe, it, expect, vi } from "vitest";
import {
  handleMessage,
  handleRead,
  handleWrite,
  replayAndNotify,
  type WorkerEnvironment,
} from "@/shared/offline/handlers";
import { createMemoryQueueStore, type QueueStore } from "@/shared/offline/queueStore";
import { QUEUED_HEADER, RUNTIME_CACHE_MAX_ENTRIES } from "@/shared/offline/config";
import type { WorkerMessage } from "@/shared/offline/messages";
import { createFakeCache, type FakeCache } from "@/test/offlineCache";

const PRECACHE = "test-precache";
const RUNTIME = "test-runtime";

interface Harness {
  readonly env: WorkerEnvironment;
  readonly store: QueueStore;
  readonly caches: Map<string, FakeCache>;
  readonly notified: WorkerMessage[];
  readonly syncRequests: number[];
}

function harness(options: {
  readonly fetch: WorkerEnvironment["fetch"];
  readonly now?: number;
  readonly requestSync?: () => Promise<void>;
}): Harness {
  const caches = new Map<string, FakeCache>([
    [PRECACHE, createFakeCache()],
    [RUNTIME, createFakeCache()],
  ]);
  const store = createMemoryQueueStore();
  const notified: WorkerMessage[] = [];
  const syncRequests: number[] = [];

  const env: WorkerEnvironment = {
    openCache: (name) => {
      const cache = caches.get(name) ?? createFakeCache();
      caches.set(name, cache);
      return Promise.resolve(cache);
    },
    fetch: options.fetch,
    store: () => Promise.resolve(store),
    now: () => options.now ?? 1_000,
    notify: (message) => {
      notified.push(message);
      return Promise.resolve();
    },
    requestSync:
      options.requestSync ??
      (() => {
        syncRequests.push(1);
        return Promise.resolve();
      }),
    precacheName: PRECACHE,
    runtimeCacheName: RUNTIME,
  };

  return { env, store, caches, notified, syncRequests };
}

describe("handleRead", () => {
  it("answers a navigation from the precached shell", async () => {
    const { env, caches } = harness({ fetch: () => Promise.reject(new Error("offline")) });
    await caches.get(PRECACHE)?.put("/index.html", new Response("<!doctype html>"));

    const result = await handleRead(env, "app-shell", new Request("https://app.test/reports/3"));

    expect(result.source).toBe("cache");
    expect(await result.response.text()).toBe("<!doctype html>");
  });

  it("serves a precached asset without touching the network", async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response("fresh")));
    const { env, caches } = harness({ fetch: fetchFn });
    await caches.get(PRECACHE)?.put("https://app.test/assets/index-a1.js", new Response("stored"));

    const result = await handleRead(
      env,
      "precached-asset",
      new Request("https://app.test/assets/index-a1.js"),
    );

    expect(await result.response.text()).toBe("stored");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("revalidates a runtime read into the runtime cache, not the precache", async () => {
    const { env, caches } = harness({ fetch: () => Promise.resolve(new Response("fresh")) });

    const result = await handleRead(
      env,
      "runtime-cache",
      new Request("https://app.test/api/posts"),
    );
    await result.done;

    expect(caches.get(RUNTIME)?.size()).toBe(1);
    // A build-keyed precache that accumulated API responses would be deleted
    // wholesale on the next deploy, and would take them with it.
    expect(caches.get(PRECACHE)?.size()).toBe(0);
  });

  it("trims the runtime cache as part of the work the worker stays alive for", async () => {
    const { env, caches } = harness({ fetch: () => Promise.resolve(new Response("fresh")) });
    const runtime = caches.get(RUNTIME);
    for (let index = 0; index < RUNTIME_CACHE_MAX_ENTRIES; index += 1) {
      await runtime?.put(`https://app.test/api/old/${index}`, new Response(`${index}`));
    }

    const result = await handleRead(env, "runtime-cache", new Request("https://app.test/api/new"));
    // Before `done` settles the cache is over its limit: trimming is chained
    // onto the revalidation so it never delays the response.
    expect(runtime?.size()).toBeGreaterThan(RUNTIME_CACHE_MAX_ENTRIES);
    await result.done;

    expect(runtime?.size()).toBe(RUNTIME_CACHE_MAX_ENTRIES);
    expect(runtime?.urls()).not.toContain("https://app.test/api/old/0");
  });
});

describe("handleWrite", () => {
  const request = (): Request =>
    new Request("https://app.test/api/posts", { method: "POST", body: '{"title":"hi"}' });

  it("sends the write when the network is there", async () => {
    const { env, store } = harness({
      fetch: () => Promise.resolve(new Response(null, { status: 201 })),
    });

    const response = await handleWrite(env, request());

    expect(response.status).toBe(201);
    expect(await store.count()).toBe(0);
  });

  it("passes a server error through instead of queueing it", async () => {
    // A 500 means the server was reached and had an opinion. Replacing it with
    // a synthetic 202 would tell the user their write is pending when it has
    // already been refused.
    const { env, store } = harness({
      fetch: () => Promise.resolve(new Response("boom", { status: 500 })),
    });

    const response = await handleWrite(env, request());

    expect(response.status).toBe(500);
    expect(await store.count()).toBe(0);
  });

  it("queues the write and answers 202 when there is no network", async () => {
    const { env, store, notified, syncRequests } = harness({
      fetch: () => Promise.reject(new Error("offline")),
    });

    const response = await handleWrite(env, request());

    expect(response.status).toBe(202);
    expect(response.headers.get(QUEUED_HEADER)).toBe("1");
    expect(await store.count()).toBe(1);
    expect(syncRequests).toHaveLength(1);
    expect(notified).toEqual([{ type: "QUEUE_STATUS", pending: 1 }]);
  });

  it("still queues where Background Sync is unavailable", async () => {
    // Safari and Firefox implement no Background Sync, and Chromium refuses it
    // when the user has blocked background synchronisation. The queue drains
    // from the page's `REPLAY_QUEUE` instead; what must not happen is the write
    // being lost because the registration threw.
    const { env, store } = harness({
      fetch: () => Promise.reject(new Error("offline")),
      requestSync: () => Promise.reject(new Error("permission denied")),
    });

    const response = await handleWrite(env, request());

    expect(response.status).toBe(202);
    expect(await store.count()).toBe(1);
  });

  it("queues a body the original request still holds", async () => {
    const { env, store } = harness({ fetch: () => Promise.reject(new Error("offline")) });

    await handleWrite(env, request());

    const [entry] = await store.list();
    expect(new TextDecoder().decode(entry?.body ?? new ArrayBuffer(0))).toBe('{"title":"hi"}');
  });
});

describe("replayAndNotify", () => {
  it("drains the queue and tells the pages", async () => {
    const { env, store, notified } = harness({
      fetch: () => Promise.resolve(new Response(null, { status: 204 })),
    });
    await handleWrite(
      { ...env, fetch: () => Promise.reject(new Error("offline")) },
      new Request("https://app.test/api/posts", { method: "POST", body: "{}" }),
    );

    const report = await replayAndNotify(env);

    expect(report.remaining).toBe(0);
    expect(await store.count()).toBe(0);
    // The target travels with the summary so the page can invalidate the
    // cache entries this write disturbed, rather than being told only that
    // "one write finished".
    expect(notified.at(-1)).toEqual({
      type: "QUEUE_REPLAYED",
      sent: 1,
      dropped: 0,
      pending: 0,
      writes: [{ method: "POST", url: "https://app.test/api/posts", fate: "sent", status: 204 }],
    });
  });
  it("serialises concurrent passes so one queued write is reported once", async () => {
    /*
      The bug an E2E run found, and the reason `replayAndNotify` has a chain.

      Coming back online produces more triggers than one — the browser's own
      `online` event, the `REPLAY_QUEUE` the page sends after it, a Background
      Sync firing around the same moment, a second tab doing the same. Run
      concurrently, every pass reads the queue before any of them has removed
      anything, so one write is fetched three times and, worse, *reported*
      three times: "3 changes could not be saved" for one change.
    */
    let inFlight = 0;
    let peak = 0;
    const { env, store } = harness({
      fetch: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        // A 422 is not retryable, so this entry leaves the queue as a loss —
        // the outcome a user is told about, and the one that must be told
        // about once.
        return new Response("no", { status: 422 });
      },
    });
    await handleWrite(
      { ...env, fetch: () => Promise.reject(new Error("offline")) },
      new Request("https://app.test/api/posts", { method: "POST", body: "{}" }),
    );

    const reports = await Promise.all([
      replayAndNotify(env, { ignoreBackoff: true }),
      replayAndNotify(env, { ignoreBackoff: true }),
      replayAndNotify(env),
    ]);

    expect(peak).toBe(1);
    const dropped = reports.flatMap((report) =>
      report.outcomes.filter((outcome) => outcome.kind === "dropped"),
    );
    expect(dropped).toHaveLength(1);
    expect(await store.count()).toBe(0);
  });

  it("keeps draining after a pass throws", async () => {
    /*
      The chain stored for the next caller swallows failures. Chaining the raw
      promise instead would let one rejected pass reject every replay that
      followed it for the lifetime of the worker — a queue that silently stops
      draining, with nothing anywhere to say why.
    */
    const { env } = harness({ fetch: () => Promise.resolve(new Response(null, { status: 204 })) });
    const broken: WorkerEnvironment = {
      ...env,
      store: () => Promise.reject(new Error("IndexedDB unavailable")),
    };

    await expect(replayAndNotify(broken)).rejects.toThrow("IndexedDB unavailable");
    await expect(replayAndNotify(broken)).rejects.toThrow("IndexedDB unavailable");
  });

  it("does not serialise two environments against each other", async () => {
    // The chain is per environment, so a test running several — or a worker
    // that somehow built two — never has one waiting on the other, and nothing
    // has to be reset between tests.
    const first = harness({ fetch: () => Promise.resolve(new Response(null, { status: 204 })) });
    const second = harness({ fetch: () => Promise.resolve(new Response(null, { status: 204 })) });

    await Promise.all([replayAndNotify(first.env), replayAndNotify(second.env)]);

    expect(first.notified.at(-1)).toMatchObject({ type: "QUEUE_REPLAYED" });
    expect(second.notified.at(-1)).toMatchObject({ type: "QUEUE_REPLAYED" });
  });
});

describe("handleMessage", () => {
  it("hands the lifecycle decision back to the worker", async () => {
    // `skipWaiting` is the one message whose effect is on the worker itself,
    // and the worker's lifecycle lives in `sw.ts`.
    const { env } = harness({ fetch: () => Promise.reject(new Error("unused")) });
    await expect(handleMessage(env, { type: "SKIP_WAITING" }, () => undefined)).resolves.toBe(
      "skip-waiting",
    );
  });

  it("answers a status request on the port it came in on", async () => {
    const { env } = harness({ fetch: () => Promise.reject(new Error("offline")) });
    await handleWrite(
      env,
      new Request("https://app.test/api/posts", { method: "POST", body: "{}" }),
    );

    const replies: WorkerMessage[] = [];
    await handleMessage(env, { type: "QUEUE_STATUS" }, (message) => replies.push(message));

    expect(replies).toEqual([{ type: "QUEUE_STATUS", pending: 1 }]);
  });

  it("replays on request", async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    const { env, notified } = harness({ fetch: fetchFn });
    await handleWrite(
      { ...env, fetch: () => Promise.reject(new Error("offline")) },
      new Request("https://app.test/api/posts", { method: "POST", body: "{}" }),
    );

    await expect(handleMessage(env, { type: "REPLAY_QUEUE" }, () => undefined)).resolves.toBe(
      "handled",
    );
    expect(notified.at(-1)).toMatchObject({ type: "QUEUE_REPLAYED", sent: 1 });
  });

  it("does not make a page that has just come online wait out a backoff", async () => {
    /*
      The sequence this covers happened in CI and not locally: Background Sync
      fired while the browser still believed it had a network, the replay
      failed, and the entry was parked behind a five-second backoff — so the
      `REPLAY_QUEUE` that followed the page coming back online found it
      deferred and the queue sat there with the user watching.
    */
    const { env, store } = harness({ fetch: () => Promise.reject(new Error("offline")) });
    await handleWrite(
      env,
      new Request("https://app.test/api/posts", { method: "POST", body: "{}" }),
    );
    await replayAndNotify(env); // a `sync` that fired too early, burning one attempt

    const online = { ...env, fetch: () => Promise.resolve(new Response(null, { status: 204 })) };
    await handleMessage(online, { type: "REPLAY_QUEUE" }, () => undefined);

    expect(await store.count()).toBe(0);
  });

  it("ignores a message it does not recognise", async () => {
    const { env } = harness({ fetch: () => Promise.reject(new Error("unused")) });
    await expect(handleMessage(env, { type: "workbox-window" }, () => undefined)).resolves.toBe(
      "ignored",
    );
  });
});
