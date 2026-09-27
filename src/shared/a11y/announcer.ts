/**
 * How urgently a message interrupts whatever the screen reader is saying.
 *
 * `polite` waits for the current utterance to finish; `assertive` stops it
 * mid-word. The default everywhere is `polite`, and the asymmetry is
 * deliberate: an interruption costs the user the sentence they were listening
 * to, so it has to be worth more than the sentence it destroys. "Saved" is not.
 */
export type Politeness = "polite" | "assertive";

export interface AnnounceOptions {
  /** Defaults to `"polite"`. */
  readonly politeness?: Politeness | undefined;
  /**
   * An identity that {@link Announcer.cancel} can retract by.
   *
   * A component that has announced "Loading posts" and then unmounts is
   * describing something nobody is waiting for any more; `useAnnounce` passes
   * its own token here so the unmount can withdraw whatever has not been
   * spoken yet. Anything already written to a region is past retracting —
   * there is no API for un-saying a sentence.
   */
  readonly owner?: unknown;
}

/** One live region pair's current content. */
export interface LiveRegionState {
  /** Which of the pair holds the text. The other holds `""`. */
  readonly slot: 0 | 1;
  readonly text: string;
}

export interface AnnouncerState {
  readonly polite: LiveRegionState;
  readonly assertive: LiveRegionState;
}

export interface Announcer {
  /** Queues `message`. Blank messages are ignored; see the module docs. */
  announce: (message: string, options?: AnnounceOptions) => void;
  /** Drops everything queued by `owner` that has not been spoken yet. */
  cancel: (owner: unknown) => void;
  subscribe: (listener: () => void) => () => void;
  getState: () => AnnouncerState;
  /** Drops every queue, timer and region's text. For tests and teardown. */
  reset: () => void;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface AnnouncerOptions {
  /** Milliseconds between two messages in the same queue. */
  readonly gapMs?: number | undefined;
  /** How many unspoken messages one queue holds before it drops its oldest. */
  readonly maxQueued?: number | undefined;
}

/**
 * Long enough that each message is a separate frame's mutation, short enough
 * that a burst does not feel like a queue. The exact number is not load-bearing
 * — anything above one frame works — but zero is broken, for the reason in the
 * module docs.
 */
const DEFAULT_GAP_MS = 150;

/**
 * A cap rather than an unbounded queue, because speech cannot be skipped.
 *
 * Thirty messages at the gap above is most of a minute of talking that the user
 * can neither fast-forward nor silence, and a burst that long only ever comes
 * from a loop — a bulk action reporting each row, a retry storm. The newest
 * message is also the truest statement of where things now stand, so overflow
 * drops from the front.
 */
const DEFAULT_MAX_QUEUED = 8;

const POLITENESS: readonly Politeness[] = ["assertive", "polite"];

const IDLE_REGION: LiveRegionState = { slot: 0, text: "" };
const IDLE_STATE: AnnouncerState = { polite: IDLE_REGION, assertive: IDLE_REGION };

interface QueuedAnnouncement {
  readonly text: string;
  readonly owner: unknown;
}

/**
 * The application's live regions, as a store rather than a component tree.
 *
 * ## Why a store and not a context
 *
 * Announcements come from everywhere — a toast, a query settling, a filter
 * narrowing to nothing — so the obvious shape is a provider near the root with
 * an `announce` on its context. That provider would hold the current
 * announcement in React state, which puts a value that changes on every toast
 * *above every route*, and re-renders the whole tree to deliver a sentence to
 * one hidden `<span>`. `OfflineIndicators.tsx` has the measurement from the
 * last time something above the routes read changing state: worst
 * keypress-to-paint went 96ms → 250ms.
 *
 * A store inverts it. `announce` is an import, so no component has to be inside
 * anything to use it and nothing re-renders to carry the message; the only
 * subscriber is the leaf that renders the regions ({@link LiveRegions}), and it
 * is a sibling of the router rather than an ancestor, so its re-render costs
 * four text nodes. It is also callable from outside React entirely — an
 * interceptor, a mutation's `onError`, a service worker message handler — which
 * a hook is not.
 *
 * ## Why messages queue instead of being written straight out
 *
 * A live region is announced when its contents change *while it is already in
 * the document*. Two messages written in one tick are one DOM mutation: the
 * first text never exists in the document at a moment any assistive technology
 * could observe, so it is not "announced late", it is never announced. Nothing
 * looks wrong — the region ends up holding the second message, which is exactly
 * what a correct single announcement looks like.
 *
 * So each queue writes one message and waits {@link DEFAULT_GAP_MS} before the
 * next. `polite` and `assertive` are separate queues with separate timers,
 * because the whole meaning of `assertive` is "do not wait", and an error made
 * to queue behind three status messages has been demoted to polite by
 * plumbing.
 *
 * ## Why two regions per politeness
 *
 * The same text set twice is not a mutation. React correctly declines to touch
 * an unchanged text node, so "No results" after "No results" is silent — and
 * "the filter still matches nothing" is precisely a thing a user asks twice.
 * Writing alternately into two regions makes every announcement an empty region
 * gaining content. `RouteAnnouncer` found this first; this is the same trick
 * generalised, which is also why that component is left alone (see
 * `docs/live-regions.md`).
 *
 * Appending a node per message to one region is the other well-known
 * mechanism and is deliberately not used: it needs pruning, pruning is a
 * removal mutation, and readers disagree about removals more than they
 * disagree about text changes.
 *
 * ## Why nothing drains before something is listening
 *
 * Effects run child-first, so a component that announces from its own effect on
 * the first commit runs *before* the `<LiveRegions>` above it has subscribed.
 * Writing then would put the text in a region no one is rendering, and the
 * region would later mount with text already in it — a new node rather than a
 * mutation, which is the one shape that reliably goes unannounced. The queue
 * therefore holds until the first subscriber arrives and drains from there.
 *
 * It also means an `announce()` in a unit test that renders no regions is a
 * bounded, silent no-op rather than a thrown error, which is the right trade
 * for a call that is never the subject of the test making it.
 */
export function createAnnouncer(options: AnnouncerOptions = {}): Announcer {
  const gapMs = options.gapMs ?? DEFAULT_GAP_MS;
  const maxQueued = options.maxQueued ?? DEFAULT_MAX_QUEUED;

  const listeners = new Set<() => void>();
  const queues: Record<Politeness, QueuedAnnouncement[]> = { polite: [], assertive: [] };
  const timers: Record<Politeness, TimerHandle | null> = { polite: null, assertive: null };
  let state: AnnouncerState = IDLE_STATE;

  function emit(): void {
    for (const listener of [...listeners]) listener();
  }

  function write(politeness: Politeness, text: string): void {
    const region: LiveRegionState = { slot: state[politeness].slot === 0 ? 1 : 0, text };
    state =
      politeness === "polite" ? { ...state, polite: region } : { ...state, assertive: region };
    emit();
  }

  function drain(politeness: Politeness): void {
    if (listeners.size === 0) return;
    if (timers[politeness] !== null) return;

    const next = queues[politeness].shift();
    if (next === undefined) return;

    write(politeness, next.text);
    /*
     * The timer is armed even when the queue is now empty, and that is the
     * point of it: it is not a delay before the next message, it is the window
     * in which this message is allowed to exist in the document on its own.
     * Arming it only for a known-next message would let a message enqueued
     * one tick later overwrite this one before anything could observe it.
     */
    timers[politeness] = setTimeout(() => {
      timers[politeness] = null;
      drain(politeness);
    }, gapMs);
  }

  return {
    announce(message, announceOptions = {}) {
      const text = message.trim();
      /*
       * A blank message is dropped rather than written. `""` is what an idle
       * region already holds, so writing it announces nothing and destroys
       * whatever a reader had not finished saying; and the way a blank one
       * arrives here is a message builder returning an empty string for a case
       * it has no words for, which wants to be silence rather than a cleared
       * region.
       */
      if (text === "") return;

      const politeness = announceOptions.politeness ?? "polite";
      const queue = queues[politeness];
      /*
       * Collapsed against what is *still queued*, never against what has been
       * spoken. Two identical messages a user caused twice are two
       * announcements they are waiting for; two in the same burst are one
       * event reported twice — which is also what `<StrictMode>` produces from
       * an announcement made in an effect, in development only.
       */
      if (queue.some((queued) => queued.text === text)) return;

      queue.push({ text, owner: announceOptions.owner });
      if (queue.length > maxQueued) queue.splice(0, queue.length - maxQueued);
      drain(politeness);
    },

    cancel(owner) {
      // `undefined` is what an unowned announcement carries, so cancelling it
      // would retract every anonymous message in the queue on any unmount.
      if (owner === undefined) return;
      for (const politeness of POLITENESS) {
        queues[politeness] = queues[politeness].filter((queued) => queued.owner !== owner);
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      // Whatever was announced before anything was rendering the regions.
      for (const politeness of POLITENESS) drain(politeness);
      return () => {
        listeners.delete(listener);
      };
    },

    getState: () => state,

    reset() {
      for (const politeness of POLITENESS) {
        queues[politeness] = [];
        const timer = timers[politeness];
        if (timer !== null) {
          clearTimeout(timer);
          timers[politeness] = null;
        }
      }
      state = IDLE_STATE;
      emit();
    },
  };
}

/** The one the application uses. */
export const announcer = createAnnouncer();

/**
 * Says something to a screen reader, from anywhere.
 *
 * Prefer `useAnnounce()` inside a component — it retracts what it queued when
 * the component goes away. This is for the places that are not components:
 * store middleware, a query client's `onError`, a worker message handler.
 */
export function announce(message: string, options?: AnnounceOptions): void {
  announcer.announce(message, options);
}
