/**
 * The service worker global scope, described rather than imported.
 *
 * `lib.webworker.d.ts` has all of these types and this project cannot have it.
 * `tsconfig.json` compiles against `DOM`, where `globalThis` is a `Window`;
 * adding `WebWorker` to `lib` does not add the worker types alongside the DOM
 * ones, it redefines `self`, `addEventListener`, `fetch` and about thirty
 * other names for *every* file in the program, and the first casualty is every
 * component that touches `window`. A second tsconfig for one directory is the
 * other standard answer, and it costs a second ESLint project, a second
 * `tsc -b` node, and a rule in every tool that has to know which files are in
 * which project.
 *
 * So the worker's contract is written out here — the subset this application
 * actually uses, not a re-implementation of the spec — and
 * `src/app/sw/sw.ts` asserts `globalThis` to it once. `src/shared/workers/csvParser.worker.ts`
 * makes the same trade for a dedicated worker and for the same reason.
 *
 * The cost is honest and worth naming: these declarations are not checked
 * against the platform. If the subset is wrong, the type checker will agree
 * with it. That is why it stays a subset — every member below is used by
 * `sw.ts`, and `e2e/offline.spec.ts` runs the result in a real browser, which
 * is the only thing that can catch a lie told here.
 */

/** An event whose lifetime can be extended past its handler's return. */
export interface ExtendableEventLike {
  /**
   * Keeps the worker alive until `promise` settles.
   *
   * Everything a handler does asynchronously needs this. A service worker is
   * terminated whenever the browser decides it is idle, which it decides by
   * looking at outstanding extended lifetimes and nothing else: a promise the
   * handler merely started is not a reason to stay alive, and work dropped
   * this way disappears with no error anywhere.
   */
  waitUntil(promise: Promise<unknown>): void;
}

/** A `fetch` the worker may answer instead of the network. */
export interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  /**
   * Answers the request. Not calling it at all is different from calling it
   * with the network's own response: the former lets the browser make the
   * request as if no worker existed, which is the cheaper and safer default
   * for anything this worker has no opinion about.
   */
  respondWith(response: Response | Promise<Response>): void;
}

/** A Background Sync wake-up. */
export interface SyncEventLike extends ExtendableEventLike {
  readonly tag: string;
  /**
   * True when the browser has given up on retrying this tag. The queue uses it
   * to decide whether a failure should be reported to the user rather than
   * quietly left for a retry that is not coming.
   */
  readonly lastChance: boolean;
}

/** Something the worker can post a message back to. */
export interface MessageTargetLike {
  postMessage(message: unknown): void;
}

/** A `postMessage` from a page this worker controls. */
export interface ExtendableMessageEventLike extends ExtendableEventLike {
  readonly data: unknown;
  readonly source: MessageTargetLike | null;
  readonly ports: readonly MessageTargetLike[];
}

/** A page under this worker's control. */
export interface ClientLike extends MessageTargetLike {
  readonly id: string;
  readonly url: string;
}

export interface ClientsLike {
  /**
   * Takes control of pages that loaded before this worker activated.
   *
   * Without it a freshly installed worker controls nothing until the next
   * navigation, so the first visit gets no offline support at all — the
   * install completes and the tab that caused it is still uncontrolled.
   */
  claim(): Promise<void>;
  matchAll(options?: { includeUncontrolled?: boolean; type?: "window" }): Promise<ClientLike[]>;
}

/** The subset of `ServiceWorkerRegistration` the worker itself reads. */
export interface RegistrationLike {
  readonly sync?: { register(tag: string): Promise<void> } | undefined;
}

export interface ServiceWorkerScope {
  readonly caches: CacheStorage;
  readonly clients: ClientsLike;
  readonly registration: RegistrationLike;
  readonly indexedDB: IDBFactory;
  fetch(input: Request | string): Promise<Response>;
  /**
   * Replaces the active worker as soon as install finishes, instead of waiting
   * for every tab on the origin to close. Paired with `clients.claim()` in
   * `activate` and with the page-side reload in `registerServiceWorker.ts`:
   * the three together are what make an update take effect, and using this one
   * alone is what makes a page run new assets under an old worker.
   */
  skipWaiting(): Promise<void>;
  addEventListener(
    type: "install" | "activate",
    listener: (event: ExtendableEventLike) => void,
  ): void;
  addEventListener(type: "fetch", listener: (event: FetchEventLike) => void): void;
  addEventListener(type: "sync", listener: (event: SyncEventLike) => void): void;
  addEventListener(type: "message", listener: (event: ExtendableMessageEventLike) => void): void;
}
