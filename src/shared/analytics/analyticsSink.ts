/**
 * Where shaped vitals rows go, and when they leave the page.
 *
 * The delivery problem is the whole reason this is a module rather than a
 * `fetch` at the call site. LCP and CLS are only *final* when the page is being
 * hidden — that is the moment web-vitals flushes its last value — which is also
 * the moment the browser stops guaranteeing that anything else runs. An
 * ordinary `fetch` started there is cancelled with the document; `unload`
 * handlers are unreliable on mobile and disqualify the page from the
 * back/forward cache, which is why nothing here listens for one.
 *
 * `navigator.sendBeacon` is the one transport specified to outlive the
 * document, with `fetch(…, { keepalive: true })` as the fallback for the case
 * it refuses (payload over the ~64KB queue limit, or no support at all).
 */

import type { VitalsEvent } from "@/shared/analytics/vitalsEvent";

/** Somewhere to put vitals rows. Implementations must never throw. */
export interface AnalyticsSink {
  /** Queues an event. May flush on its own once the queue is full. */
  record: (event: VitalsEvent) => void;
  /** Sends everything queued now. A no-op when nothing is queued. */
  flush: () => void;
}

/**
 * Sends a serialized batch, returning whether it was handed off.
 *
 * Returning a boolean rather than a promise is deliberate: at page hide there
 * is no later to await in, so "did the browser accept this" is the only answer
 * that exists.
 */
export type AnalyticsTransport = (endpoint: string, body: string) => boolean;

/** The wire format: one POST carries the whole batch. */
export interface VitalsPayload {
  events: VitalsEvent[];
}

/**
 * `sendBeacon` first, `fetch` with `keepalive` second, give up third.
 *
 * The body is JSON but goes out as `text/plain` — a bare string to
 * `sendBeacon`, and no `Content-Type` header on the fetch. That is the point,
 * not an oversight: `application/json` makes this a non-simple request, and a
 * cross-origin non-simple request needs a preflight the browser will not run
 * while the page is being torn down. A collector that expects JSON should read
 * the body and parse it.
 */
export const beaconTransport: AnalyticsTransport = (endpoint, body) => {
  try {
    if (navigator.sendBeacon(endpoint, body)) return true;
  } catch {
    // No `sendBeacon` at all (jsdom, old WebViews). Fall through.
  }

  try {
    void fetch(endpoint, {
      method: "POST",
      body,
      // Lets the request outlive the document, the same property that makes
      // `sendBeacon` usable here.
      keepalive: true,
    }).catch(() => undefined);
    return true;
  } catch {
    // No `fetch` either, or it threw synchronously on a malformed endpoint.
    return false;
  }
};

export interface BeaconSinkOptions {
  /** Collector URL. Same-origin avoids a preflight the browser may drop. */
  endpoint: string;
  transport?: AnalyticsTransport;
  /**
   * Queue length that forces an early flush. Three metrics per page visit is
   * the normal case; the cap only matters for a long-lived SPA session where
   * INP keeps being revised upward.
   */
  maxQueuedEvents?: number;
}

/**
 * Batching sink. One request per flush, and one row per metric instance.
 *
 * Coalescing by `event.id` is what makes the batch correct rather than merely
 * small: `onCLS`/`onINP` re-report the *same* metric instance as its value
 * grows, so a queue that appended would send two rows for one page's CLS and
 * any backend that sums or counts would be wrong.
 */
export function createBeaconSink(options: BeaconSinkOptions): AnalyticsSink {
  const { endpoint, transport = beaconTransport, maxQueuedEvents = 24 } = options;
  const queued = new Map<string, VitalsEvent>();

  const flush = (): void => {
    if (queued.size === 0) return;
    const payload: VitalsPayload = { events: [...queued.values()] };
    // Cleared before the send, not after: at page hide a failed batch has
    // nowhere to be retried, and a queue that keeps rejected rows would resend
    // them on the next flush as if they were new.
    queued.clear();
    try {
      transport(endpoint, JSON.stringify(payload));
    } catch {
      // A telemetry failure must never surface as an application error.
    }
  };

  return {
    record(event) {
      queued.set(event.id, event);
      if (queued.size >= maxQueuedEvents) flush();
    },
    flush,
  };
}

/** Logs each metric as it is reported. The sink you want during development. */
export function createConsoleSink(logger: Pick<Console, "info"> = console): AnalyticsSink {
  return {
    record(event) {
      logger.info(
        `[web-vitals] ${event.metric} ${event.value} (${event.rating}) on ${event.path}`,
        event,
      );
    },
    // Console output is already immediate; there is nothing held back.
    flush() {},
  };
}

/** A sink that keeps everything in memory. For tests and Storybook. */
export interface MemorySink extends AnalyticsSink {
  /** Every event recorded, in order. */
  readonly events: VitalsEvent[];
  /** One entry per non-empty flush, holding the batch that was sent. */
  readonly batches: VitalsEvent[][];
}

export function createMemorySink(): MemorySink {
  const events: VitalsEvent[] = [];
  const batches: VitalsEvent[][] = [];
  let unflushed: VitalsEvent[] = [];

  return {
    events,
    batches,
    record(event) {
      events.push(event);
      unflushed.push(event);
    },
    flush() {
      if (unflushed.length === 0) return;
      batches.push(unflushed);
      unflushed = [];
    },
  };
}

export interface EnvSinkOptions {
  /** `VITE_ANALYTICS_URL`, or an empty string when unset. */
  endpoint: string;
  /** Whether to fall back to console logging when no endpoint is configured. */
  dev: boolean;
  transport?: AnalyticsTransport;
}

/**
 * Picks a sink from configuration, or `null` when reporting is off.
 *
 * `null` rather than a no-op sink so the caller can skip subscribing entirely:
 * an unconfigured build should not be paying for three `PerformanceObserver`s
 * to feed a sink that discards.
 */
export function createSinkFromEnv(options: EnvSinkOptions): AnalyticsSink | null {
  const { endpoint, dev, transport } = options;
  if (endpoint !== "") {
    return createBeaconSink(transport ? { endpoint, transport } : { endpoint });
  }
  return dev ? createConsoleSink() : null;
}

/**
 * The two methods this module needs from `document` and `window`.
 *
 * Narrower than `EventTarget` on purpose: the DOM's overloaded
 * `addEventListener` cannot be satisfied by a plain object, so a test double
 * would be impossible to write against the real type.
 */
export interface EventTargetLike {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

export interface FlushOnHiddenOptions {
  doc?: EventTargetLike;
  win?: EventTargetLike;
  isHidden?: () => boolean;
}

/**
 * Flushes the sink at the last moment the browser reliably runs script.
 *
 * Both events are needed and neither is redundant. `visibilitychange` covers
 * backgrounding — switching tabs or apps — which on mobile is how most visits
 * end and may be the last callback the page ever gets. `pagehide` covers the
 * navigations that never hide the page first, including the ones that freeze it
 * into the back/forward cache.
 *
 * Returns a disposer; deliberately not `unload` or `beforeunload`, which
 * prevent bfcache eligibility and are ignored outright on iOS.
 */
export function flushOnHidden(sink: AnalyticsSink, options: FlushOnHiddenOptions = {}): () => void {
  const {
    doc = document,
    win = window,
    isHidden = () => document.visibilityState === "hidden",
  } = options;

  const onVisibilityChange = (): void => {
    if (isHidden()) sink.flush();
  };
  const onPageHide = (): void => {
    sink.flush();
  };

  doc.addEventListener("visibilitychange", onVisibilityChange);
  win.addEventListener("pagehide", onPageHide);

  return () => {
    doc.removeEventListener("visibilitychange", onVisibilityChange);
    win.removeEventListener("pagehide", onPageHide);
  };
}
