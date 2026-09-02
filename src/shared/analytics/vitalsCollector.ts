/**
 * Subscribing to the Core Web Vitals and forwarding them to a sink.
 *
 * Two constraints shape this module, and neither is obvious from the
 * `web-vitals` API:
 *
 * **`onCLS` / `onINP` / `onLCP` cannot be undone.** Each one installs a
 * `PerformanceObserver` and there is no unsubscribe, so calling them from a
 * React effect would double-subscribe under StrictMode's mount → unmount →
 * mount and report every metric twice. The fix is to bind them exactly once per
 * subscriptions object and let callers add and remove *listeners* on top, which
 * is what a `stop()` here actually detaches.
 *
 * **Sampling is decided once per page visit, not per metric.** Rolling the dice
 * on each report would keep a visit's LCP and drop its INP, and any question of
 * the form "do slow-loading pages also respond slowly?" would then be
 * unanswerable from the data. One roll per visit means the sample is a subset
 * of *visits*, which is the population the metrics describe.
 */

import { onCLS, onINP, onLCP } from "web-vitals/attribution";
import type { MetricWithAttribution } from "web-vitals/attribution";
import type { AnalyticsSink } from "@/shared/analytics/analyticsSink";
import { toVitalsEvent } from "@/shared/analytics/vitalsEvent";

export type VitalsListener = (metric: MetricWithAttribution) => void;

/** The three `web-vitals` entry points, injectable so tests can drive them. */
export interface VitalsSubscriptions {
  onCLS: (report: VitalsListener) => void;
  onINP: (report: VitalsListener) => void;
  onLCP: (report: VitalsListener) => void;
}

/**
 * The real library, from the attribution build.
 *
 * The attribution build is a little larger and is what makes a report
 * actionable: without it a poor INP is a number, with it the row names the
 * element that was slow and which of the three phases the time went to.
 */
export const webVitalsSubscriptions: VitalsSubscriptions = { onCLS, onINP, onLCP };

/**
 * Listener sets keyed by the subscriptions object they are bound through.
 *
 * Keyed rather than global so a test can bind its own fakes without inheriting
 * another test's subscription — and so production, which always passes the same
 * singleton above, binds the real observers exactly once per page.
 */
const boundListeners = new WeakMap<VitalsSubscriptions, Set<VitalsListener>>();

function listenersFor(subscriptions: VitalsSubscriptions): Set<VitalsListener> {
  const existing = boundListeners.get(subscriptions);
  if (existing) return existing;

  const listeners = new Set<VitalsListener>();
  boundListeners.set(subscriptions, listeners);

  const dispatch: VitalsListener = (metric) => {
    // Copied because a listener is free to remove itself while being called —
    // a component unmounting in response to a metric is not a special case.
    for (const listener of [...listeners]) listener(metric);
  };

  subscriptions.onCLS(dispatch);
  subscriptions.onINP(dispatch);
  subscriptions.onLCP(dispatch);

  return listeners;
}

/** `crypto.randomUUID` where it exists, a random string where it does not. */
function createVisitId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // `crypto.randomUUID` is unavailable on insecure origins.
    return `visit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export interface VitalsCollectionOptions {
  sink: AnalyticsSink;
  subscriptions?: VitalsSubscriptions;
  /** Share of visits reported, 0–1. Defaults to every visit. */
  sampleRate?: number;
  random?: () => number;
  /** The route to attribute a report to, read when the metric arrives. */
  getPath?: () => string;
  now?: () => number;
  newVisitId?: () => string;
}

/** Whether this visit is in the sample. */
export function isSampledIn(sampleRate: number, random: () => number): boolean {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return false;
  if (sampleRate >= 1) return true;
  return random() < sampleRate;
}

/**
 * Starts forwarding Core Web Vitals to `sink`. Returns a function that stops it.
 *
 * A visit outside the sample subscribes to nothing at all, so an unreported
 * visit costs no observers rather than costing observers whose output is
 * discarded.
 */
export function startVitalsCollection(options: VitalsCollectionOptions): () => void {
  const {
    sink,
    subscriptions = webVitalsSubscriptions,
    sampleRate = 1,
    random = Math.random,
    getPath = () => window.location.pathname,
    now = Date.now,
    newVisitId = createVisitId,
  } = options;

  if (!isSampledIn(sampleRate, random)) {
    return () => {
      // Nothing was subscribed, so there is nothing to detach.
    };
  }

  const visitId = newVisitId();
  const listeners = listenersFor(subscriptions);

  const listener: VitalsListener = (metric) => {
    // The path is read here rather than at start-up because these metrics
    // arrive late: INP in particular is finalised at page hide, by which time
    // an SPA may be several routes away from where it loaded.
    const event = toVitalsEvent(metric, { path: getPath(), visitId, reportedAt: now() });
    if (event) sink.record(event);
  };

  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
