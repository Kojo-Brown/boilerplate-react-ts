import { act } from "@testing-library/react";

/** One `new IntersectionObserver(...)`, as a test can inspect it. */
export interface ObserverRecord {
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly threshold: readonly number[];
  /** Targets currently observed by this instance. */
  readonly targets: readonly Element[];
  readonly disconnected: boolean;
}

export interface IntersectionHarness {
  /** Every observer constructed since install, oldest first. */
  readonly observers: readonly ObserverRecord[];
  /** The live observer watching `target`, or `undefined`. */
  observerFor(target: Element): ObserverRecord | undefined;
  /**
   * Report `target` as intersecting (or not) to every live observer watching
   * it, wrapped in `act` so the resulting render is flushed.
   *
   * Reporting the value it already has still delivers a callback, exactly as a
   * real observer does on `observe()`. What a real observer will *not* do is
   * deliver one when nothing changed while it was already watching — which is
   * the stall `VirtualInfiniteList` has to survive, so no test may fake its
   * way out of it by calling this again.
   */
  setIntersecting(target: Element, isIntersecting: boolean): void;
  /**
   * Deliver several entries for `target` in a single callback.
   *
   * A real observer coalesces observations into one invocation, so a callback
   * reading `entries[0]` reads a value that may already have been superseded
   * inside the same array. Nothing else can produce that shape.
   */
  deliverEntries(target: Element, values: readonly boolean[]): void;
  /** How many observers are still live. Unwinding leaks show up here. */
  liveCount(): number;
  restore(): void;
}

interface Instance {
  record: {
    root: Element | Document | null;
    rootMargin: string;
    threshold: readonly number[];
    targets: Element[];
    disconnected: boolean;
  };
  callback: IntersectionObserverCallback;
  observer: IntersectionObserver;
}

/**
 * A controllable `IntersectionObserver`.
 *
 * jsdom implements none of the Intersection Observer API — not the constructor,
 * and not the layout it would need to produce an answer. So this is not a
 * polyfill and does not pretend to be: it records what each observer was
 * constructed with and lets the test say what the answer is. Nothing here
 * computes an intersection, because nothing in jsdom could.
 *
 * That boundary is why the real geometry — a sentinel that has to trip a
 * `rootMargin` before the end of a 10,000-row scroll range — is asserted in
 * `e2e/windowed-infinite-scroll.spec.ts` against a browser, and why the unit
 * tests here assert the two things a harness genuinely can: what the observer
 * was *asked* (its root and margin, which is where the viewport-vs-container
 * mistake shows up) and what the component *does* with the answer.
 */
export function installIntersectionObserver(): IntersectionHarness {
  const instances: Instance[] = [];
  const original = Reflect.get(globalThis, "IntersectionObserver") as unknown;

  class FakeIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null;
    readonly rootMargin: string;
    /**
     * Part of the DOM interface as of the scroll-margin addition, and unused
     * here: nothing in this codebase sets it, and a fake that computes no
     * geometry has nothing to apply it to.
     */
    readonly scrollMargin: string;
    readonly thresholds: readonly number[];
    readonly #instance: Instance;

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.root = options?.root ?? null;
      this.rootMargin = options?.rootMargin ?? "0px";
      this.scrollMargin = "0px";
      const threshold = options?.threshold ?? 0;
      this.thresholds = typeof threshold === "number" ? [threshold] : [...threshold];
      this.#instance = {
        record: {
          root: this.root,
          rootMargin: this.rootMargin,
          threshold: this.thresholds,
          targets: [],
          disconnected: false,
        },
        callback,
        observer: this,
      };
      instances.push(this.#instance);
    }

    observe(target: Element): void {
      if (!this.#instance.record.targets.includes(target)) {
        this.#instance.record.targets.push(target);
      }
    }

    unobserve(target: Element): void {
      const { targets } = this.#instance.record;
      const index = targets.indexOf(target);
      if (index !== -1) targets.splice(index, 1);
    }

    disconnect(): void {
      this.#instance.record.targets.length = 0;
      this.#instance.record.disconnected = true;
    }

    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: FakeIntersectionObserver,
  });

  function live(): Instance[] {
    return instances.filter((i) => !i.record.disconnected);
  }

  return {
    get observers() {
      return instances.map((i) => ({ ...i.record, targets: [...i.record.targets] }));
    },
    observerFor(target) {
      const found = live().find((i) => i.record.targets.includes(target));
      return found ? { ...found.record, targets: [...found.record.targets] } : undefined;
    },
    setIntersecting(target, isIntersecting) {
      this.deliverEntries(target, [isIntersecting]);
    },
    deliverEntries(target, values) {
      const watching = live().filter((i) => i.record.targets.includes(target));
      const entries = values.map(
        (isIntersecting) =>
          ({
            target,
            isIntersecting,
            intersectionRatio: isIntersecting ? 1 : 0,
            time: 0,
            // The rects are not computed — nothing in jsdom has a layout to
            // compute them from — and nothing under test reads them.
            boundingClientRect: target.getBoundingClientRect(),
            intersectionRect: target.getBoundingClientRect(),
            rootBounds: null,
          }) satisfies IntersectionObserverEntry,
      );
      act(() => {
        for (const instance of watching) {
          instance.callback(entries, instance.observer);
        }
      });
    },
    liveCount() {
      return live().length;
    },
    restore() {
      if (original === undefined) {
        Reflect.deleteProperty(globalThis, "IntersectionObserver");
        return;
      }
      Object.defineProperty(globalThis, "IntersectionObserver", {
        configurable: true,
        writable: true,
        value: original,
      });
    },
  };
}
