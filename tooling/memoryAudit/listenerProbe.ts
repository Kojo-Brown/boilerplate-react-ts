/**
 * The listener half of the audit: a census of every `addEventListener` that
 * has not been matched by a `removeEventListener`.
 *
 * A heap snapshot tells you *that* nodes are detached. It is much worse at
 * telling you *why*, because the commonest cause — a listener registered on
 * something long-lived, closing over something short-lived — shows up in the
 * retainer path as an unnamed `context` edge under a `system / Context`. This
 * counts the registrations directly, which turns "something is retaining the
 * dashboard" into "three `resize` listeners on `window` that nothing removed".
 *
 * ## Why it wraps `EventTarget.prototype` rather than asking the browser
 *
 * `getEventListeners(target)` exists, but only as a DevTools *console* helper:
 * there is no CDP command behind it and no way to call it from page script, so
 * a listener audit built on it can only be run by a human with the inspector
 * open. Wrapping the prototype at document start works in any browser, needs
 * no protocol access, and — the part that matters for a gate — is the same
 * code under Vitest and under Playwright, so the counting logic is unit-tested
 * rather than trusted.
 *
 * ## Two deliberate omissions
 *
 * **`once: true` listeners are not counted.** The DOM removes them itself when
 * they fire, without going through `removeEventListener`, so a probe that
 * counted them would report every fired one-shot as an unremoved listener
 * forever. Under-counting a listener that is guaranteed to remove itself is
 * the safe direction; over-counting would make the gate cry leak on correct
 * code, which is how a gate gets switched off.
 *
 * **Targets are held weakly.** The probe must not be the reason something
 * stays alive: a `Set<EventTarget>` here would keep every node it ever saw out
 * of the collector's reach and the audit would report a heap it created. The
 * registry holds `WeakRef`s and compacts the dead ones each census.
 */

/** Where the probe hangs itself on the page's global. */
export const LISTENER_PROBE_KEY = "__memoryAuditListeners__";

/** Live registrations against one target, for one event type. */
export interface ListenerCensusEntry {
  /** A human label: `window`, `document`, `div#root`, `AbortSignal`. */
  readonly target: string;
  readonly type: string;
  readonly count: number;
  /** True when the target is a DOM node that is no longer in the document. */
  readonly detached: boolean;
}

export interface ListenerCensus {
  readonly entries: readonly ListenerCensusEntry[];
  /** Live registrations, across every target. */
  readonly total: number;
  /** The subset of `total` registered on nodes out of the document. */
  readonly detachedTotal: number;
}

/**
 * Installs the probe on the current global.
 *
 * Written as one self-contained function on purpose: Playwright ships it into
 * the page with `fn.toString()`, so it must not close over an import, a
 * module-level constant, or a compiler helper. That is also why the global key
 * is repeated as a literal below instead of referencing
 * {@link LISTENER_PROBE_KEY} — the exported constant does not exist inside the
 * page, and referencing it produces a `ReferenceError` at document start with
 * no stack that points here.
 *
 * Idempotent: installing twice would double-count every registration, and
 * Playwright runs init scripts once per document *including* iframes.
 */
export function installListenerProbe(): void {
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope["__memoryAuditListeners__"] !== undefined) return;

  /** Registration keys (`type|listenerId|capture`) per target. */
  const perTarget = new WeakMap<EventTarget, Map<string, Set<string>>>();
  /** Weak handles to every target that has ever held a live registration. */
  const targets = new Set<WeakRef<EventTarget>>();
  const handles = new WeakMap<EventTarget, WeakRef<EventTarget>>();
  /** Identity for listener functions and `handleEvent` objects. */
  const listenerIds = new WeakMap<object, number>();
  let nextListenerId = 1;

  const captureOf = (options: unknown): boolean => {
    if (typeof options === "boolean") return options;
    if (typeof options === "object" && options !== null) {
      return Boolean((options as { capture?: unknown }).capture);
    }
    return false;
  };

  const isOnce = (options: unknown): boolean =>
    typeof options === "object" &&
    options !== null &&
    Boolean((options as { once?: unknown }).once);

  const keyFor = (listener: unknown, capture: boolean): string | null => {
    if (typeof listener !== "function" && (typeof listener !== "object" || listener === null)) {
      return null;
    }
    const object: object = listener;
    let id = listenerIds.get(object);
    if (id === undefined) {
      id = nextListenerId;
      nextListenerId += 1;
      listenerIds.set(object, id);
    }
    return `${String(id)}|${capture ? "1" : "0"}`;
  };

  const record = (
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options: AddEventListenerOptions | boolean | undefined,
  ): void => {
    if (isOnce(options)) return;
    const key = keyFor(listener, captureOf(options));
    if (key === null) return;
    let byType = perTarget.get(target);
    if (byType === undefined) {
      byType = new Map<string, Set<string>>();
      perTarget.set(target, byType);
    }
    let keys = byType.get(type);
    if (keys === undefined) {
      keys = new Set<string>();
      byType.set(type, keys);
    }
    // A `Set`, because re-registering an identical (type, listener, capture)
    // triple is a no-op in the DOM. Counting adds instead would report a leak
    // for a component that re-subscribes idempotently.
    keys.add(key);
    if (!handles.has(target)) {
      const handle = new WeakRef(target);
      handles.set(target, handle);
      targets.add(handle);
    }
  };

  const forget = (
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options: EventListenerOptions | boolean | undefined,
  ): void => {
    const key = keyFor(listener, captureOf(options));
    if (key === null) return;
    perTarget.get(target)?.get(type)?.delete(key);
  };

  /**
   * Wraps one object's own `addEventListener` / `removeEventListener`.
   *
   * `EventTarget.prototype` is the only holder in a real browser, but it is
   * not the only one that can exist: jsdom defines both methods directly on
   * the window object, so a probe that patched the prototype alone counts
   * every element listener and none of the `window` ones — silently, and in
   * exactly the environment the unit tests run in. Patching each holder that
   * *owns* the method, and calling that holder's own native through the
   * wrapper, covers both without assuming which shape is in play.
   */
  const patch = (holder: object): void => {
    const own = holder as {
      addEventListener: typeof EventTarget.prototype.addEventListener;
      removeEventListener: typeof EventTarget.prototype.removeEventListener;
    };
    const nativeAdd = own.addEventListener;
    const nativeRemove = own.removeEventListener;

    own.addEventListener = function patchedAddEventListener(
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: AddEventListenerOptions | boolean,
    ): void {
      record(this, type, listener, options);
      nativeAdd.call(this, type, listener, options);
    };

    own.removeEventListener = function patchedRemoveEventListener(
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: EventListenerOptions | boolean,
    ): void {
      forget(this, type, listener, options);
      nativeRemove.call(this, type, listener, options);
    };
  };

  patch(EventTarget.prototype);
  for (const holder of [globalThis, typeof Document === "undefined" ? null : Document.prototype]) {
    if (holder !== null && Object.prototype.hasOwnProperty.call(holder, "addEventListener")) {
      patch(holder);
    }
  }

  const describe = (target: EventTarget): string => {
    // Identity before `instanceof`. The two disagree wherever the global
    // object and the DOM's `Window` are not the same object — Vitest's jsdom
    // environment being the case these tests run in, where `window ===
    // globalThis` holds but `window instanceof Window` does not, and the
    // label silently degrades to "Object".
    if ((target as unknown) === globalThis) return "window";
    const doc = (globalThis as unknown as { document?: unknown }).document;
    if (doc !== undefined && (target as unknown) === doc) return "document";
    if (typeof Window !== "undefined" && target instanceof Window) return "window";
    if (typeof Document !== "undefined" && target instanceof Document) return "document";
    if (typeof Element !== "undefined" && target instanceof Element) {
      const id = target.id === "" ? "" : `#${target.id}`;
      const className =
        typeof target.className === "string" && target.className !== ""
          ? `.${target.className.trim().split(/\s+/).join(".")}`
          : "";
      return `${target.tagName.toLowerCase()}${id}${className}`;
    }
    if (typeof Node !== "undefined" && target instanceof Node) {
      return `#${target.nodeName.toLowerCase()}`;
    }
    const name: unknown = (target as { constructor?: { name?: unknown } }).constructor?.name;
    return typeof name === "string" ? name : "EventTarget";
  };

  // Annotated with the exported types rather than structural copies: type
  // annotations are erased before this function is stringified into the page,
  // so they cost nothing there while still being checked here.
  const census = (): ListenerCensus => {
    const entries: ListenerCensusEntry[] = [];
    let total = 0;
    let detachedTotal = 0;

    for (const handle of [...targets]) {
      const target = handle.deref();
      if (target === undefined) {
        // Collected. Dropping the handle is what keeps the registry from
        // growing without bound over a long session.
        targets.delete(handle);
        continue;
      }
      const byType = perTarget.get(target);
      if (byType === undefined) continue;
      const detached =
        typeof Node !== "undefined" && target instanceof Node ? !target.isConnected : false;
      let live = 0;
      for (const [type, keys] of byType) {
        if (keys.size === 0) continue;
        live += keys.size;
        entries.push({ target: describe(target), type, count: keys.size, detached });
      }
      if (live === 0) {
        targets.delete(handle);
        continue;
      }
      total += live;
      if (detached) detachedTotal += live;
    }

    entries.sort(
      (a, b) =>
        b.count - a.count || a.target.localeCompare(b.target) || a.type.localeCompare(b.type),
    );
    return { entries, total, detachedTotal };
  };

  scope["__memoryAuditListeners__"] = { census };
}

/**
 * Reads the census from the current global.
 *
 * Self-contained for the same reason {@link installListenerProbe} is: this is
 * what gets handed to `page.evaluate`. Throws rather than returning an empty
 * census when the probe is missing — an audit that silently reports zero
 * listeners because its own init script never ran is worse than a red test.
 */
export function readListenerProbeCensus(): ListenerCensus {
  const probe = (globalThis as unknown as Record<string, unknown>)["__memoryAuditListeners__"];
  if (probe === undefined) {
    throw new Error(
      "Listener probe is not installed. Add installListenerProbe as a page init script.",
    );
  }
  return (probe as { census: () => ListenerCensus }).census();
}

/** How one (target, type) pair moved between two censuses. */
export interface ListenerDelta {
  readonly target: string;
  readonly type: string;
  readonly before: number;
  readonly after: number;
  readonly growth: number;
  readonly detached: boolean;
}

/**
 * Pairs two censuses up, biggest growth first.
 *
 * Only pairs that moved are returned: a stable registration is the normal case
 * and listing it buries the one line that matters. Pairs that *shrank* are
 * kept, though — a negative row is how you find the teardown that removed more
 * than its own listeners.
 */
export function diffListenerCensus(before: ListenerCensus, after: ListenerCensus): ListenerDelta[] {
  const key = (entry: ListenerCensusEntry): string => `${entry.target} ${entry.type}`;
  const fold = (census: ListenerCensus): Map<string, ListenerCensusEntry> => {
    const folded = new Map<string, ListenerCensusEntry>();
    for (const entry of census.entries) {
      const existing = folded.get(key(entry));
      folded.set(
        key(entry),
        existing === undefined
          ? entry
          : {
              target: entry.target,
              type: entry.type,
              count: existing.count + entry.count,
              detached: existing.detached || entry.detached,
            },
      );
    }
    return folded;
  };

  const beforeByKey = fold(before);
  const afterByKey = fold(after);

  const deltas: ListenerDelta[] = [];
  for (const mapKey of new Set([...beforeByKey.keys(), ...afterByKey.keys()])) {
    const beforeEntry = beforeByKey.get(mapKey);
    const afterEntry = afterByKey.get(mapKey);
    const reference = afterEntry ?? beforeEntry;
    if (reference === undefined) continue;
    const beforeCount = beforeEntry?.count ?? 0;
    const afterCount = afterEntry?.count ?? 0;
    if (beforeCount === afterCount) continue;
    deltas.push({
      target: reference.target,
      type: reference.type,
      before: beforeCount,
      after: afterCount,
      growth: afterCount - beforeCount,
      detached: afterEntry?.detached ?? false,
    });
  }

  return deltas.sort(
    (a, b) =>
      b.growth - a.growth || a.target.localeCompare(b.target) || a.type.localeCompare(b.type),
  );
}
