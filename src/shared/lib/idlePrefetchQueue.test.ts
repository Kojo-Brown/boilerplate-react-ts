import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createIdleScheduler,
  createPrefetchQueue,
  FALLBACK_IDLE_BUDGET_MS,
  FALLBACK_IDLE_DELAY_MS,
  type ChunkRegistry,
  type IdleCallback,
  type IdleScheduler,
  type PrefetchQueue,
} from "@/shared/lib/idlePrefetchQueue";

/**
 * A scheduler the test drives.
 *
 * Local rather than the shared `src/test/prefetch.ts` harness: that one wraps
 * flushes in `act` for component tests, and nothing here renders. It also
 * deliberately does *not* auto-run callbacks scheduled during a flush — a
 * budget that a harness can drain in one go is not being tested.
 */
function createFakeScheduler() {
  const pending = new Map<number, IdleCallback>();
  const cancelled: number[] = [];
  let nextHandle = 1;

  const scheduler: IdleScheduler = {
    request(callback) {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      cancelled.push(handle);
      pending.delete(handle);
    },
  };

  return {
    scheduler,
    cancelled,
    scheduledCount: () => pending.size,
    /** Run the callbacks waiting *now*, with a deadline reporting `remaining`. */
    flush(remaining = 50): number {
      const due = [...pending.entries()];
      for (const [handle] of due) pending.delete(handle);
      for (const [, callback] of due) callback({ timeRemaining: () => remaining });
      return due.length;
    },
  };
}

interface Loads {
  readonly registry: ChunkRegistry;
  readonly calls: readonly string[];
  settle(href: string, ok?: boolean): Promise<void>;
}

function createLoads(hrefs: readonly string[]): Loads {
  const calls: string[] = [];
  const settlers = new Map<string, { ok: () => void; fail: (e: Error) => void }>();
  const registry: Record<string, () => Promise<unknown>> = {};

  for (const href of hrefs) {
    registry[href] = () => {
      calls.push(href);
      return new Promise<void>((resolve, reject) => {
        settlers.set(href, { ok: resolve, fail: reject });
      });
    };
  }

  return {
    registry,
    get calls() {
      return [...calls];
    },
    async settle(href, ok = true) {
      const settler = settlers.get(href);
      if (settler === undefined) throw new Error(`no outstanding load for ${href}`);
      settlers.delete(href);
      if (ok) settler.ok();
      else settler.fail(new Error(`chunk failed: ${href}`));
      // One turn for the loader's promise, one for the queue's `.then`.
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

const HOME = "/";
const ABOUT = "/about";
const DASH = "/dashboard";
const LABS = "/labs/headless";

function setup(options: Partial<Parameters<typeof createPrefetchQueue>[0]> = {}) {
  const fake = createFakeScheduler();
  const loads = createLoads([HOME, ABOUT, DASH, LABS]);
  const queue: PrefetchQueue = createPrefetchQueue({
    registry: loads.registry,
    scheduler: fake.scheduler,
    ...options,
  });
  const deactivate = queue.activate();
  return { fake, loads, queue, deactivate };
}

describe("createPrefetchQueue", () => {
  it("does not load anything until the browser goes idle", () => {
    const { fake, loads, queue } = setup();

    queue.request(ABOUT, "hover");

    expect(loads.calls).toEqual([]);
    expect(queue.stateOf(ABOUT)).toBe("queued");

    fake.flush();

    expect(loads.calls).toEqual([ABOUT]);
    expect(queue.stateOf(ABOUT)).toBe("loading");
  });

  it("dispatches nothing when the idle period is nearly over", () => {
    const { fake, loads, queue } = setup({ minIdleMs: 8 });

    queue.request(ABOUT, "hover");
    const ran = fake.flush(3);

    // The callback ran — this is not "it was never scheduled".
    expect(ran).toBe(1);
    expect(loads.calls).toEqual([]);
    expect(queue.stateOf(ABOUT)).toBe("queued");

    // …and it asked to be woken again, rather than dropping the entry.
    expect(fake.scheduledCount()).toBe(1);
    fake.flush(50);
    expect(loads.calls).toEqual([ABOUT]);
  });

  /**
   * The claim from the module comment, as a test.
   *
   * The deadline reports a constant 50ms and is never decremented — because
   * dispatching cannot decrement it, `import()` being asynchronous. A loop that
   * budgeted against `timeRemaining()` would therefore drain all four entries
   * here in one callback. `maxPerIdle` is the only thing that stops it.
   */
  it("dispatches at most maxPerIdle per callback even with a deadline that never shrinks", () => {
    const { fake, loads, queue } = setup({ maxPerIdle: 2, maxInFlight: 4 });

    queue.request(HOME, "hover");
    queue.request(ABOUT, "hover");
    queue.request(DASH, "hover");
    queue.request(LABS, "hover");

    fake.flush(50);

    expect(loads.calls).toEqual([HOME, ABOUT]);
  });

  it("keeps at most maxInFlight chunk requests on the wire", async () => {
    const { fake, loads, queue } = setup({ maxInFlight: 2, maxPerIdle: 10 });

    queue.request(HOME, "hover");
    queue.request(ABOUT, "hover");
    queue.request(DASH, "hover");

    fake.flush();
    expect(loads.calls).toEqual([HOME, ABOUT]);

    // Saturated, so nothing is scheduled: another idle period would only hand
    // back a callback with nothing to do.
    expect(fake.scheduledCount()).toBe(0);

    await loads.settle(HOME);

    expect(fake.scheduledCount()).toBe(1);
    fake.flush();
    expect(loads.calls).toEqual([HOME, ABOUT, DASH]);
  });

  it("puts a hover ahead of viewport guesses already waiting", () => {
    const { fake, loads, queue } = setup({ maxPerIdle: 1 });

    queue.request(HOME, "viewport");
    queue.request(ABOUT, "viewport");
    queue.request(DASH, "hover");

    fake.flush();

    expect(loads.calls).toEqual([DASH]);
  });

  it("promotes a queued viewport guess instead of queueing it twice", () => {
    const { fake, loads, queue } = setup({ maxPerIdle: 1 });

    queue.request(HOME, "viewport");
    queue.request(ABOUT, "viewport");
    queue.request(ABOUT, "hover");

    expect(queue.snapshot().queued).toEqual([ABOUT, HOME]);

    fake.flush();
    expect(loads.calls).toEqual([ABOUT]);

    // Promotion did not leave a duplicate behind.
    fake.flush();
    expect(loads.calls).toEqual([ABOUT, HOME]);
  });

  it("does not demote a hover that is later seen in the viewport", () => {
    const { queue } = setup();

    queue.request(HOME, "viewport");
    queue.request(ABOUT, "hover");
    queue.request(ABOUT, "viewport");

    expect(queue.snapshot().queued).toEqual([ABOUT, HOME]);
  });

  it("ignores hrefs the registry has no loader for", () => {
    const { fake, loads, queue } = setup();

    queue.request("/not-a-route", "hover");

    expect(queue.stateOf("/not-a-route")).toBe("unrequested");
    expect(fake.scheduledCount()).toBe(0);
    fake.flush();
    expect(loads.calls).toEqual([]);
  });

  it("cancel unqueues and stops the pending idle callback", () => {
    const { fake, loads, queue } = setup();

    queue.request(ABOUT, "hover");
    expect(fake.scheduledCount()).toBe(1);

    queue.cancel(ABOUT);

    expect(queue.stateOf(ABOUT)).toBe("unrequested");
    expect(fake.cancelled).toHaveLength(1);
    expect(fake.flush()).toBe(0);
    expect(loads.calls).toEqual([]);
  });

  it("cancel cannot recall a dispatched load", async () => {
    const { fake, loads, queue } = setup();

    queue.request(ABOUT, "hover");
    fake.flush();
    expect(queue.stateOf(ABOUT)).toBe("loading");

    queue.cancel(ABOUT);

    expect(queue.stateOf(ABOUT)).toBe("loading");
    await loads.settle(ABOUT);
    expect(queue.stateOf(ABOUT)).toBe("loaded");
  });

  it("never re-requests a route it has already loaded", async () => {
    const { fake, loads, queue } = setup();

    queue.request(ABOUT, "hover");
    fake.flush();
    await loads.settle(ABOUT);

    queue.request(ABOUT, "hover");
    fake.flush();

    expect(loads.calls).toEqual([ABOUT]);
  });

  it("retries a failed prefetch rather than recording it as loaded", async () => {
    const { fake, loads, queue } = setup({ maxAttempts: 2 });

    queue.request(ABOUT, "hover");
    fake.flush();
    await loads.settle(ABOUT, false);

    expect(queue.stateOf(ABOUT)).toBe("unrequested");
    expect(queue.snapshot().loaded).toEqual([]);

    queue.request(ABOUT, "hover");
    fake.flush();
    expect(loads.calls).toEqual([ABOUT, ABOUT]);
  });

  it("gives up on a route after maxAttempts failures", async () => {
    const { fake, loads, queue } = setup({ maxAttempts: 2 });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      queue.request(ABOUT, "hover");
      fake.flush();
      await loads.settle(ABOUT, false);
    }

    expect(queue.stateOf(ABOUT)).toBe("exhausted");

    queue.request(ABOUT, "hover");
    fake.flush();

    expect(loads.calls).toEqual([ABOUT, ABOUT]);
  });

  // A rejected chunk is swallowed by the queue's two-arm `.then`, not merely
  // by nobody looking: Vitest fails a run on an unhandled rejection, so the
  // two failure tests above are the assertion. A speculative fetch that failed
  // must not reach `window.onunhandledrejection` and be reported as a page
  // error by whatever error reporter the app installs.

  it("notifies subscribers and keeps the snapshot identity stable between changes", () => {
    const { fake, queue } = setup();
    const listener = vi.fn();
    const unsubscribe = queue.subscribe(listener);

    const before = queue.snapshot();
    expect(queue.snapshot()).toBe(before);

    queue.request(ABOUT, "hover");
    expect(listener).toHaveBeenCalledTimes(1);
    const afterRequest = queue.snapshot();
    expect(afterRequest).not.toBe(before);
    expect(afterRequest.queued).toEqual([ABOUT]);

    fake.flush();
    expect(queue.snapshot().loading).toEqual([ABOUT]);

    unsubscribe();
    queue.request(DASH, "hover");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("schedules nothing until it is activated", () => {
    const fake = createFakeScheduler();
    const loads = createLoads([ABOUT]);
    const queue = createPrefetchQueue({ registry: loads.registry, scheduler: fake.scheduler });

    // A link can hover during the render pass, before its provider's effect
    // has run. The entry waits rather than being lost.
    queue.request(ABOUT, "hover");
    expect(fake.scheduledCount()).toBe(0);
    expect(queue.stateOf(ABOUT)).toBe("queued");

    queue.activate();

    expect(fake.scheduledCount()).toBe(1);
    fake.flush();
    expect(loads.calls).toEqual([ABOUT]);
  });

  it("deactivating cancels the pending callback and stops dispatching", () => {
    const { fake, loads, queue, deactivate } = setup();

    queue.request(ABOUT, "hover");
    deactivate();

    expect(fake.cancelled).toHaveLength(1);
    queue.request(DASH, "hover");
    expect(fake.scheduledCount()).toBe(0);
    fake.flush();
    expect(loads.calls).toEqual([]);
  });

  /**
   * The failure StrictMode produces, as a test.
   *
   * React mounts, runs effects, runs their cleanups, and mounts again. A queue
   * whose teardown were irreversible would be dead from the first commit — in
   * development only, with no error: requests still queue, and `schedule()`
   * just returns early forever, which is indistinguishable from a browser that
   * is never idle.
   */
  it("survives a deactivate/activate cycle with its queue and its loaded set intact", async () => {
    const { fake, loads, queue, deactivate } = setup();

    queue.request(ABOUT, "hover");
    fake.flush();
    await loads.settle(ABOUT);
    queue.request(DASH, "hover");

    deactivate();
    queue.activate();

    expect(queue.stateOf(ABOUT)).toBe("loaded");
    expect(queue.stateOf(DASH)).toBe("queued");

    fake.flush();
    expect(loads.calls).toEqual([ABOUT, DASH]);

    // …and the route already fetched is not fetched a second time.
    queue.request(ABOUT, "hover");
    fake.flush();
    expect(loads.calls).toEqual([ABOUT, DASH]);
  });

  it("a callback already handed out runs harmlessly after deactivation", () => {
    // `cancelIdleCallback` is best-effort: a callback the browser has already
    // committed to running still runs. Captured here rather than left in the
    // fake so that disposal genuinely cannot take it back.
    let captured: IdleCallback | null = null;
    const loads = createLoads([ABOUT]);
    const queue = createPrefetchQueue({
      registry: loads.registry,
      scheduler: {
        request(callback) {
          captured = callback;
          return 1;
        },
        cancel: () => undefined,
      },
    });

    const deactivate = queue.activate();
    queue.request(ABOUT, "hover");
    deactivate();

    expect(captured).not.toBeNull();
    (captured as unknown as IdleCallback)({ timeRemaining: () => 50 });

    expect(loads.calls).toEqual([]);
  });
});

describe("createIdleScheduler", () => {
  const realRequest = Reflect.get(window, "requestIdleCallback") as unknown;

  afterEach(() => {
    vi.useRealTimers();
    if (realRequest === undefined) {
      Reflect.deleteProperty(window, "requestIdleCallback");
      Reflect.deleteProperty(window, "cancelIdleCallback");
    }
  });

  it("uses requestIdleCallback when the browser has one", () => {
    const request = vi.fn().mockReturnValue(7);
    const cancel = vi.fn();
    Object.defineProperty(window, "requestIdleCallback", { configurable: true, value: request });
    Object.defineProperty(window, "cancelIdleCallback", { configurable: true, value: cancel });

    const scheduler = createIdleScheduler(window);
    const callback = vi.fn();
    const handle = scheduler.request(callback);

    expect(handle).toBe(7);
    // No options argument: a `timeout` would force the callback through on a
    // page that never goes idle, which is the opposite of the point.
    expect(request).toHaveBeenCalledWith(callback);

    scheduler.cancel(handle);
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it("falls back to a delayed timeout where requestIdleCallback is missing", () => {
    // jsdom has no `requestIdleCallback`, which is the branch under test.
    expect(Reflect.get(window, "requestIdleCallback")).toBeUndefined();
    vi.useFakeTimers();

    const scheduler = createIdleScheduler(window);
    const callback = vi.fn();
    scheduler.request(callback);

    vi.advanceTimersByTime(FALLBACK_IDLE_DELAY_MS - 1);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);

    const deadline = callback.mock.calls[0]?.[0] as { timeRemaining(): number };
    expect(deadline.timeRemaining()).toBe(FALLBACK_IDLE_BUDGET_MS);
  });

  it("the fallback handle can be cancelled", () => {
    vi.useFakeTimers();
    const scheduler = createIdleScheduler(window);
    const callback = vi.fn();

    scheduler.cancel(scheduler.request(callback));
    vi.advanceTimersByTime(FALLBACK_IDLE_DELAY_MS * 2);

    expect(callback).not.toHaveBeenCalled();
  });

  it("the fallback budget clears the queue's default gate", () => {
    // Otherwise the fallback would schedule callbacks that always decline to
    // dispatch, and prefetching would be silently dead everywhere
    // `requestIdleCallback` is missing rather than merely unhurried.
    const fallbackDeadline = { timeRemaining: () => FALLBACK_IDLE_BUDGET_MS };
    const loads = createLoads([ABOUT]);
    const queue = createPrefetchQueue({
      registry: loads.registry,
      scheduler: { request: () => 1, cancel: () => undefined },
    });

    queue.activate();
    queue.request(ABOUT, "hover");
    expect(fallbackDeadline.timeRemaining()).toBeGreaterThanOrEqual(8);
  });
});
