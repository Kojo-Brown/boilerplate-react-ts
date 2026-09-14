/**
 * Durable storage for writes that could not be sent.
 *
 * IndexedDB rather than the Cache API or `localStorage`, for reasons that are
 * all about *when* a service worker runs. The worker is terminated whenever
 * the browser decides it is idle and started again by an event, possibly hours
 * later and with no page open: in-memory state does not survive that, and
 * `localStorage` is not available in a worker at all (it is synchronous, and
 * workers may not block). The Cache API could hold the requests but not their
 * attempt counts, and a queue whose retry state lives somewhere else is a
 * queue that replays from zero after every restart.
 */

/** A write waiting to be sent. */
export interface QueuedRequest {
  /** Auto-incrementing key. Also the queue's ordering — see `syncQueue.ts`. */
  readonly id: number;
  readonly url: string;
  readonly method: string;
  /**
   * Header pairs, not a `Headers`. A `Headers` is not structured-cloneable, so
   * storing one throws `DataCloneError` at the point where the user has just
   * gone offline — the single moment where this code must not fail.
   */
  readonly headers: readonly (readonly [string, string])[];
  /**
   * The body as bytes.
   *
   * An `ArrayBuffer` clones into IndexedDB natively and covers every body a
   * `fetch` can carry — JSON, form encoding, a file. Storing text instead
   * would be smaller code and would corrupt any upload that is not UTF-8.
   */
  readonly body: ArrayBuffer | null;
  readonly queuedAt: number;
  readonly attempts: number;
  /** Earliest time a replay may be attempted, from the backoff schedule. */
  readonly nextAttemptAt: number;
}

export type NewQueuedRequest = Omit<QueuedRequest, "id">;

/**
 * The queue's storage, as a port.
 *
 * `syncQueue.ts` holds the replay policy and talks only to this interface, so
 * the policy is tested against an in-memory store while the IndexedDB adapter
 * below is tested against a real IndexedDB implementation. Neither test has to
 * carry the other's setup, and both halves are covered.
 */
export interface QueueStore {
  add(entry: NewQueuedRequest): Promise<QueuedRequest>;
  /** Every entry, oldest first. */
  list(): Promise<readonly QueuedRequest[]>;
  update(entry: QueuedRequest): Promise<void>;
  remove(id: number): Promise<void>;
  count(): Promise<number>;
  clear(): Promise<void>;
}

export const QUEUE_DB_NAME = "offline-write-queue";
export const QUEUE_STORE_NAME = "requests";

/** Opens (and, on first use, creates) the queue database. */
export function openQueueDb(
  factory: IDBFactory,
  name: string = QUEUE_DB_NAME,
  version = 1,
): Promise<IDBDatabase> {
  const open = factory.open(name, version);
  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains(QUEUE_STORE_NAME)) {
      // `autoIncrement` is what makes the key monotonic, and the key is what
      // makes the queue FIFO. Ordering by `queuedAt` instead would collapse
      // two writes made in the same millisecond into an arbitrary order —
      // which is precisely the case a form that saves on every keystroke
      // produces.
      db.createObjectStore(QUEUE_STORE_NAME, { keyPath: "id", autoIncrement: true });
    }
  };
  return promisify(open);
}

/** The IndexedDB-backed implementation of {@link QueueStore}. */
export function createIdbQueueStore(db: IDBDatabase): QueueStore {
  function store(mode: IDBTransactionMode): IDBObjectStore {
    return db.transaction(QUEUE_STORE_NAME, mode).objectStore(QUEUE_STORE_NAME);
  }

  return {
    async add(entry) {
      const key = await promisify(store("readwrite").add(entry));
      return { ...entry, id: Number(key) };
    },
    async list() {
      // `getAll` on a store with no index returns entries in key order, which
      // for an auto-incrementing key is insertion order.
      // Typed as `unknown[]` rather than IndexedDB's own `any[]`: every row is
      // validated below, and `any` would make the validation unenforceable.
      const rows = await promisify<unknown[]>(store("readonly").getAll());
      return rows.map(parseQueuedRequest).filter((row): row is QueuedRequest => row !== null);
    },
    async update(entry) {
      await promisify(store("readwrite").put(entry));
    },
    async remove(id) {
      await promisify(store("readwrite").delete(id));
    },
    count() {
      return promisify(store("readonly").count());
    },
    async clear() {
      await promisify(store("readwrite").clear());
    },
  };
}

/** An in-memory {@link QueueStore}, for tests and for a browser with no IndexedDB. */
export function createMemoryQueueStore(): QueueStore {
  const rows = new Map<number, QueuedRequest>();
  let nextId = 1;
  return {
    add(entry) {
      const row = { ...entry, id: nextId++ };
      rows.set(row.id, row);
      return Promise.resolve(row);
    },
    list() {
      return Promise.resolve([...rows.values()].sort((a, b) => a.id - b.id));
    },
    update(entry) {
      if (rows.has(entry.id)) rows.set(entry.id, entry);
      return Promise.resolve();
    },
    remove(id) {
      rows.delete(id);
      return Promise.resolve();
    },
    count() {
      return Promise.resolve(rows.size);
    },
    clear() {
      rows.clear();
      return Promise.resolve();
    },
  };
}

/**
 * Validates a row read back from storage.
 *
 * The database outlives the code that wrote it: a user who opens the
 * application after a deploy may hold rows written by a build that shaped them
 * differently, and an unvalidated read turns that into a `TypeError` inside a
 * `sync` event, where nothing is watching. A row that does not parse is
 * dropped by `list`, which is the same outcome the user would have had if the
 * write had never been queued.
 */
export function parseQueuedRequest(value: unknown): QueuedRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row["id"] !== "number") return null;
  if (typeof row["url"] !== "string" || typeof row["method"] !== "string") return null;
  if (typeof row["queuedAt"] !== "number" || typeof row["attempts"] !== "number") return null;
  if (typeof row["nextAttemptAt"] !== "number") return null;
  const body = row["body"];
  if (body !== null && !isArrayBuffer(body)) return null;
  const headers = row["headers"];
  if (!Array.isArray(headers)) return null;
  const pairs: (readonly [string, string])[] = [];
  for (const pair of headers) {
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    const [name, headerValue] = pair as unknown[];
    if (typeof name !== "string" || typeof headerValue !== "string") return null;
    pairs.push([name, headerValue]);
  }
  return {
    id: row["id"],
    url: row["url"],
    method: row["method"],
    headers: pairs,
    body,
    queuedAt: row["queuedAt"],
    attempts: row["attempts"],
    nextAttemptAt: row["nextAttemptAt"],
  };
}

/**
 * `instanceof ArrayBuffer`, except across realms.
 *
 * A value that has crossed a structured-clone boundary — which is every value
 * read back out of IndexedDB — may have been constructed by a different realm's
 * `ArrayBuffer`, and `instanceof` compares constructors rather than shapes. It
 * is right far more often than it is wrong, and where it is wrong it silently
 * discards every queued write, which is the one failure this module exists to
 * prevent. The brand check has no such edge.
 */
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

/** Turns one `IDBRequest` into a promise. */
function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB request failed"));
    };
  });
}
