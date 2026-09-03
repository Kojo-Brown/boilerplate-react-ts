/**
 * The idle-time budget behind route prefetching.
 *
 * A speculative fetch is only ever worth making when it costs the user
 * nothing, and "costs nothing" is two separate claims: the main thread is not
 * busy, and the network is not busy. This module is the thing that enforces
 * both, because the obvious implementation enforces neither.
 *
 * ## `timeRemaining()` is a gate, not a budget
 *
 * The shape everyone writes first subtracts an estimated cost from
 * `deadline.timeRemaining()` and keeps dispatching until the estimate runs
 * out. That is wrong here, and not by a little: the work a prefetch causes is
 * a `import()`, which **returns immediately**. The network round trip, the
 * parse and the module evaluation all happen after the idle callback has
 * returned, on a deadline that no longer exists. So `timeRemaining()` cannot
 * be spent against them — it only answers "is right now a calm moment to
 * start one", and it answers it identically for the first dispatch and the
 * tenth. A loop that trusts it therefore fires the entire queue inside one
 * callback and puts six chunk requests on the wire at once, which is the exact
 * contention the idle callback was supposed to avoid, arrived at by way of the
 * API that exists to prevent it.
 *
 * The budget that actually bounds anything is therefore a count, not a
 * duration: {@link PrefetchQueueOptions.maxPerIdle} per callback and
 * {@link PrefetchQueueOptions.maxInFlight} at a time. `timeRemaining()` stays,
 * as the gate it really is — below {@link PrefetchQueueOptions.minIdleMs} the
 * callback dispatches nothing and waits for a calmer one.
 *
 * ## No `timeout` option
 *
 * `requestIdleCallback(cb, { timeout })` promises the callback runs *even if
 * the browser never goes idle*, which for a speculative fetch is precisely the
 * wrong promise: it converts "do this if it is free" into "do this, and if it
 * is not free, do it anyway during a busy frame". A route the user never
 * visits is not worth one dropped frame, so this queue passes no timeout and
 * accepts that on a permanently busy page nothing is prefetched at all. That
 * is the correct outcome, and it is why {@link createIdleScheduler} is a
 * separate seam — a test can supply a deadline, but nothing can supply a
 * reason to skip the gate.
 */

/** The part of `IdleDeadline` this queue reads. */
export interface IdleDeadlineLike {
  readonly timeRemaining: () => number;
}

export type IdleCallback = (deadline: IdleDeadlineLike) => void;

/** The injectable idle-callback seam. See {@link createIdleScheduler}. */
export interface IdleScheduler {
  readonly request: (callback: IdleCallback) => number;
  readonly cancel: (handle: number) => void;
}

/**
 * How strong the signal was that the user is heading for this route.
 *
 * A pointer resting on a link is a near-commitment; a link scrolling into view
 * is a guess. They share a queue but not a position in it — see
 * {@link PrefetchQueue.request}.
 */
export type PrefetchPriority = "hover" | "viewport";

export type ChunkLoader = () => Promise<unknown>;

/** Route href → the dynamic import that loads that route's chunk. */
export type ChunkRegistry = Readonly<Record<string, ChunkLoader>>;

export interface PrefetchQueueOptions {
  readonly registry: ChunkRegistry;
  readonly scheduler: IdleScheduler;
  /**
   * Idle milliseconds that must still remain before a dispatch is allowed.
   *
   * Half a 60Hz frame. Not a cost estimate — see the module comment; it is the
   * width of the calm the queue insists on before starting anything.
   */
  readonly minIdleMs?: number;
  /** Chunk requests allowed on the wire at once. */
  readonly maxInFlight?: number;
  /** Dispatches allowed from a single idle callback. */
  readonly maxPerIdle?: number;
  /**
   * Times one route may be attempted before the queue gives up on it.
   *
   * A prefetch that rejects is forgotten rather than remembered as loaded, so
   * a transient failure is retried on the next hover. A chunk that is *gone* —
   * the usual cause being a redeploy that renamed it under an open tab — would
   * otherwise be re-requested on every hover for the life of the tab, so
   * attempts are capped. Navigation is unaffected either way: it loads the
   * route through `React.lazy`, which holds its own `import()` and never
   * consults this queue.
   */
  readonly maxAttempts?: number;
}

export type PrefetchState = "unrequested" | "queued" | "loading" | "loaded" | "exhausted";

/** What the queue is doing, for anything that wants to display it. */
export interface PrefetchSnapshot {
  readonly queued: readonly string[];
  readonly loading: readonly string[];
  readonly loaded: readonly string[];
}

export interface PrefetchQueue {
  /**
   * Ask for `href` to be prefetched when the browser next goes idle.
   *
   * Cheap and idempotent: an href already loaded, already in flight, unknown
   * to the registry, or out of attempts is dropped on the floor. An href
   * already queued at `viewport` priority and asked for again at `hover` is
   * *promoted* rather than duplicated — the guess was right, and the queue
   * should reflect that without the link having to know it was already there.
   */
  readonly request: (href: string, priority: PrefetchPriority) => void;
  /**
   * Withdraw a queued request — a pointer that left before the dwell elapsed.
   *
   * Only ever unqueues. A dispatched `import()` cannot be cancelled: there is
   * no abort signal on the module loader, and the bytes are already being
   * fetched. Pretending otherwise would be the more comfortable API and a lie.
   */
  readonly cancel: (href: string) => void;
  readonly stateOf: (href: string) => PrefetchState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Stable between changes, so `useSyncExternalStore` can hold it. */
  readonly snapshot: () => PrefetchSnapshot;
  /**
   * Start draining, and return the function that stops it again.
   *
   * A queue is created **inactive**: it accepts requests and schedules
   * nothing. Two reasons, and the second is why this is `activate()` returning
   * a teardown rather than a `dispose()` the owner calls on unmount.
   *
   * The small one: a link can request during the render pass, before its
   * provider's effect has run, and those entries should wait rather than be
   * lost.
   *
   * The real one is StrictMode. React mounts, runs effects, runs their
   * cleanups, and mounts again — so a queue torn down by an unmount cleanup is
   * torn down for good on the very first commit, in development only. Nothing
   * throws. Hovering a link still calls `request`, the entry still queues, and
   * `schedule()` simply returns early forever: the app looks identical to one
   * where prefetching is working and the browser is merely never idle. This
   * shape survives it, because deactivation is reversible — the second mount
   * calls `activate()` again and picks up the same queue, including everything
   * it had already loaded.
   *
   * Idempotent: activating an active queue returns a teardown for the same
   * activation rather than nesting.
   */
  readonly activate: () => () => void;
}

const DEFAULT_MIN_IDLE_MS = 8;
const DEFAULT_MAX_IN_FLIGHT = 2;
const DEFAULT_MAX_PER_IDLE = 2;
const DEFAULT_MAX_ATTEMPTS = 2;

interface QueueEntry {
  readonly href: string;
  priority: PrefetchPriority;
}

export function createPrefetchQueue({
  registry,
  scheduler,
  minIdleMs = DEFAULT_MIN_IDLE_MS,
  maxInFlight = DEFAULT_MAX_IN_FLIGHT,
  maxPerIdle = DEFAULT_MAX_PER_IDLE,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
}: PrefetchQueueOptions): PrefetchQueue {
  const queue: QueueEntry[] = [];
  const inFlight = new Set<string>();
  const loaded = new Set<string>();
  const attempts = new Map<string, number>();
  const listeners = new Set<() => void>();

  let handle: number | null = null;
  let active = false;
  let cached: PrefetchSnapshot | null = null;

  function changed(): void {
    cached = null;
    for (const listener of listeners) listener();
  }

  function schedule(): void {
    if (!active || handle !== null) return;
    if (queue.length === 0) return;
    // Deliberately not scheduled while saturated. The callback would have
    // nothing to do, and `requestIdleCallback` would keep handing us one every
    // idle period until a load settled. The settle handler calls back here.
    if (inFlight.size >= maxInFlight) return;
    handle = scheduler.request(run);
  }

  function settled(href: string, ok: boolean): void {
    inFlight.delete(href);
    if (ok) loaded.add(href);
    changed();
    schedule();
  }

  function dispatch(href: string): void {
    const load = registry[href];
    // Unreachable: `request` refuses hrefs the registry does not know, so
    // nothing unknown is ever queued. Kept as a guard rather than a
    // non-null assertion because the registry is supplied by the caller.
    if (load === undefined) return;

    inFlight.add(href);
    attempts.set(href, (attempts.get(href) ?? 0) + 1);
    // Both arms are supplied, so a rejected chunk never reaches
    // `unhandledrejection` — a speculative fetch failing is not a page error.
    // The rejection is also not recorded as loaded, which is what lets a
    // later attempt (and the real navigation) try the module again.
    void load().then(
      () => {
        settled(href, true);
      },
      () => {
        settled(href, false);
      },
    );
  }

  function run(deadline: IdleDeadlineLike): void {
    handle = null;
    // `cancelIdleCallback` is best-effort: a callback the browser has already
    // committed to still runs, so deactivation is re-checked here.
    if (!active) return;

    let dispatched = 0;
    while (
      queue.length > 0 &&
      dispatched < maxPerIdle &&
      inFlight.size < maxInFlight &&
      deadline.timeRemaining() >= minIdleMs
    ) {
      const next = queue.shift();
      if (next === undefined) break;
      dispatch(next.href);
      dispatched += 1;
    }

    if (dispatched > 0) changed();
    schedule();
  }

  /**
   * Where a new entry goes: hovers ahead of every viewport guess, each group
   * FIFO. A hover arriving while five viewport entries wait should be the next
   * thing fetched, not the sixth.
   */
  function insert(entry: QueueEntry): void {
    if (entry.priority === "viewport") {
      queue.push(entry);
      return;
    }
    const firstGuess = queue.findIndex((e) => e.priority === "viewport");
    if (firstGuess === -1) queue.push(entry);
    else queue.splice(firstGuess, 0, entry);
  }

  return {
    request(href, priority) {
      if (loaded.has(href) || inFlight.has(href)) return;
      if ((attempts.get(href) ?? 0) >= maxAttempts) return;
      if (registry[href] === undefined) return;

      const existing = queue.findIndex((e) => e.href === href);
      if (existing !== -1) {
        const entry = queue[existing];
        if (entry === undefined || entry.priority === priority || priority === "viewport") return;
        // Promotion: re-inserted rather than mutated in place, because its
        // position is what the priority means.
        queue.splice(existing, 1);
        entry.priority = "hover";
        insert(entry);
        changed();
        return;
      }

      insert({ href, priority });
      changed();
      schedule();
    },

    cancel(href) {
      const index = queue.findIndex((e) => e.href === href);
      if (index === -1) return;
      queue.splice(index, 1);
      changed();
      if (queue.length === 0 && handle !== null) {
        scheduler.cancel(handle);
        handle = null;
      }
    },

    stateOf(href) {
      if (loaded.has(href)) return "loaded";
      if (inFlight.has(href)) return "loading";
      if (queue.some((e) => e.href === href)) return "queued";
      if ((attempts.get(href) ?? 0) >= maxAttempts) return "exhausted";
      return "unrequested";
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    snapshot() {
      cached ??= {
        queued: queue.map((e) => e.href),
        loading: [...inFlight],
        loaded: [...loaded],
      };
      return cached;
    },

    activate() {
      active = true;
      schedule();
      return () => {
        active = false;
        if (handle !== null) {
          scheduler.cancel(handle);
          handle = null;
        }
        // The queue and the loaded set are kept. Under StrictMode this
        // teardown is followed by another `activate()` on the same queue, and
        // clearing here would make the first mount's work vanish.
      };
    },
  };
}

/** Delay before the non-`requestIdleCallback` fallback runs a batch. */
export const FALLBACK_IDLE_DELAY_MS = 150;

/**
 * Slack the fallback claims it has.
 *
 * A `setTimeout` knows nothing about whether the main thread is free, so this
 * is an assertion rather than a measurement — kept just above
 * {@link DEFAULT_MIN_IDLE_MS} so the gate passes, and low enough that a caller
 * raising `minIdleMs` genuinely opts out of the fallback.
 */
export const FALLBACK_IDLE_BUDGET_MS = 10;

type RequestIdleFn = (callback: (deadline: IdleDeadline) => void) => number;
type CancelIdleFn = (handle: number) => void;

/**
 * The real idle scheduler, with a `setTimeout` fallback.
 *
 * `requestIdleCallback` is missing from Safari before 16.4 and from jsdom, and
 * the fallback is a delayed timeout rather than `setTimeout(…, 0)` on purpose:
 * zero would run the batch in the very next task, competing with whatever
 * input handling made the page busy in the first place — an idle scheduler
 * that is never idle. A delay at least defers past the burst.
 *
 * The window is a parameter so a test can drive both branches; the `number`
 * handle comes from `win.setTimeout` rather than the bare global, which under
 * `@types/node` is typed to return a `Timeout` object instead.
 */
export function createIdleScheduler(win: Window = window): IdleScheduler {
  // Read reflectively: lib.dom declares both unconditionally, so a `typeof`
  // check against the declared type narrows nothing and tells the reader
  // nothing about why it is here.
  const requestIdle = Reflect.get(win, "requestIdleCallback") as RequestIdleFn | undefined;
  const cancelIdle = Reflect.get(win, "cancelIdleCallback") as CancelIdleFn | undefined;

  if (typeof requestIdle === "function" && typeof cancelIdle === "function") {
    return {
      request: (callback) => requestIdle.call(win, callback),
      cancel: (handle) => {
        cancelIdle.call(win, handle);
      },
    };
  }

  return {
    request: (callback) =>
      win.setTimeout(() => {
        callback({ timeRemaining: () => FALLBACK_IDLE_BUDGET_MS });
      }, FALLBACK_IDLE_DELAY_MS),
    cancel: (handle) => {
      win.clearTimeout(handle);
    },
  };
}
