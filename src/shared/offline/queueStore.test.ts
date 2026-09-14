import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  createIdbQueueStore,
  createMemoryQueueStore,
  openQueueDb,
  parseQueuedRequest,
  QUEUE_STORE_NAME,
  type NewQueuedRequest,
  type QueueStore,
} from "@/shared/offline/queueStore";

/**
 * A real IndexedDB implementation, in memory, per test.
 *
 * jsdom has no IndexedDB at all, so the choice is between testing the adapter
 * against `fake-indexeddb` and not testing it — and the adapter is where the
 * queue's durability lives. A fresh `IDBFactory` per test is what keeps the
 * databases from leaking between them.
 */
let factory: IDBFactory;

beforeEach(() => {
  factory = new IDBFactory();
});

function entry(overrides: Partial<NewQueuedRequest> = {}): NewQueuedRequest {
  return {
    url: "https://app.test/api/posts",
    method: "POST",
    headers: [["content-type", "application/json"]],
    body: new TextEncoder().encode('{"title":"hello"}').buffer,
    queuedAt: 1_000,
    attempts: 0,
    nextAttemptAt: 1_000,
    ...overrides,
  };
}

async function idbStore(name = "queue-test"): Promise<QueueStore> {
  return createIdbQueueStore(await openQueueDb(factory, name));
}

describe.each([
  ["IndexedDB", () => idbStore()],
  ["memory", () => Promise.resolve(createMemoryQueueStore())],
])("%s queue store", (_name, create) => {
  it("returns entries in the order they were queued", async () => {
    const store = await create();
    await store.add(entry({ url: "https://app.test/api/a" }));
    await store.add(entry({ url: "https://app.test/api/b" }));
    await store.add(entry({ url: "https://app.test/api/c" }));

    // FIFO is not a nicety here: a PATCH and the DELETE that follows it do not
    // commute, and the id is what preserves the user's order.
    expect((await store.list()).map((row) => row.url)).toEqual([
      "https://app.test/api/a",
      "https://app.test/api/b",
      "https://app.test/api/c",
    ]);
  });

  it("assigns an id the caller can update and remove by", async () => {
    const store = await create();
    const added = await store.add(entry());
    expect(added.id).toBeGreaterThan(0);

    await store.update({ ...added, attempts: 3, nextAttemptAt: 9_000 });
    expect((await store.list())[0]).toMatchObject({
      id: added.id,
      attempts: 3,
      nextAttemptAt: 9_000,
    });

    await store.remove(added.id);
    expect(await store.count()).toBe(0);
  });

  it("round-trips the body as bytes", async () => {
    const store = await create();
    const added = await store.add(entry());
    const stored = (await store.list())[0];
    expect(new TextDecoder().decode(stored?.body ?? new ArrayBuffer(0))).toBe('{"title":"hello"}');
    expect(stored?.headers).toEqual(added.headers);
  });

  it("clears everything", async () => {
    const store = await create();
    await store.add(entry());
    await store.add(entry());
    await store.clear();
    expect(await store.count()).toBe(0);
  });
});

describe("the IndexedDB adapter specifically", () => {
  it("survives the database being closed and reopened", async () => {
    // The whole reason for IndexedDB over a module-level array: a service
    // worker is terminated whenever the browser judges it idle, and the queue
    // has to still be there when an event starts it again.
    const first = await idbStore("durability");
    await first.add(entry({ url: "https://app.test/api/kept" }));

    const second = await idbStore("durability");
    expect((await second.list()).map((row) => row.url)).toEqual(["https://app.test/api/kept"]);
  });

  it("drops a row written by a build that shaped it differently", async () => {
    const db = await openQueueDb(factory, "legacy");
    const store = createIdbQueueStore(db);
    await store.add(entry({ url: "https://app.test/api/valid" }));

    // A row from an older release, written before `nextAttemptAt` existed.
    await new Promise<void>((resolve, reject) => {
      const request = db
        .transaction(QUEUE_STORE_NAME, "readwrite")
        .objectStore(QUEUE_STORE_NAME)
        .add({ url: "https://app.test/api/legacy", method: "POST", queuedAt: 1 });
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        reject(request.error ?? new Error("write failed"));
      };
    });

    // Dropped rather than thrown on: the alternative is a `TypeError` inside a
    // `sync` event, where nothing is watching and the whole queue stops.
    expect((await store.list()).map((row) => row.url)).toEqual(["https://app.test/api/valid"]);
    // `count` is the raw row count, so the difference is visible rather than
    // silently reconciled.
    expect(await store.count()).toBe(2);
  });

  it("is idempotent about creating its object store", async () => {
    await idbStore("twice");
    await expect(idbStore("twice")).resolves.toBeDefined();
  });
});

describe("parseQueuedRequest", () => {
  const valid = { ...entry(), id: 1 };

  it("accepts a well-formed row", () => {
    expect(parseQueuedRequest(valid)).toMatchObject({ id: 1, method: "POST" });
  });

  it("accepts a row with no body", () => {
    expect(parseQueuedRequest({ ...valid, body: null })?.body).toBeNull();
  });

  it.each([
    ["not an object", 42],
    ["null", null],
    ["a missing id", { ...valid, id: undefined }],
    ["a non-string url", { ...valid, url: 7 }],
    ["a non-numeric attempt count", { ...valid, attempts: "many" }],
    ["a missing schedule", { ...valid, nextAttemptAt: undefined }],
    ["a body that is not bytes", { ...valid, body: "text" }],
    ["headers that are not pairs", { ...valid, headers: ["content-type"] }],
    ["a header pair holding a number", { ...valid, headers: [["retry-count", 3]] }],
    ["headers that are not a list", { ...valid, headers: { "content-type": "application/json" } }],
  ])("rejects %s", (_case, value) => {
    expect(parseQueuedRequest(value)).toBeNull();
  });
});
