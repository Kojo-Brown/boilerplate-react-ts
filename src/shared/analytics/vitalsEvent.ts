/**
 * Turning a `web-vitals` metric into the row an analytics backend stores.
 *
 * The library hands back an object that is convenient in the browser and wrong
 * to transmit: `entries` holds live `PerformanceEntry` instances, and the LCP
 * attribution carries whole `PerformanceNavigationTiming` and
 * `PerformanceResourceTiming` objects. `JSON.stringify` turns those into either
 * `{}` or several kilobytes of timings nobody queries, and `navigator.sendBeacon`
 * silently refuses a payload over the user-agent's queue limit — so an
 * unshaped metric is not a large row, it is a row that never arrives.
 *
 * What survives here is what a dashboard actually groups by (the value, the
 * rating, the route) plus the attribution fields that say *why* the number is
 * what it is. For LCP those four subparts sum to the metric, which is the
 * difference between "LCP is 4.1s" and "3.4s of it was the server".
 */

import type {
  CLSMetricWithAttribution,
  INPMetricWithAttribution,
  LCPMetricWithAttribution,
  Metric,
  MetricWithAttribution,
} from "web-vitals/attribution";

/**
 * The three Core Web Vitals. `web-vitals` also reports FCP and TTFB; they are
 * diagnostics that explain an LCP rather than metrics Google ranks on, and
 * this module is deliberately narrower than the library.
 */
export type CoreVitalName = "CLS" | "INP" | "LCP";

export type VitalsRating = Metric["rating"];
export type VitalsNavigationType = Metric["navigationType"];

/** Everything about a report that comes from the app rather than the metric. */
export interface VitalsContext {
  /** Route the SPA was showing when the metric was reported. */
  path: string;
  /** Groups every metric reported from a single page visit. */
  visitId: string;
  /** Wall-clock time of the report, in ms since the epoch. */
  reportedAt: number;
}

interface VitalsEventBase extends VitalsContext {
  /**
   * The metric instance id from `web-vitals`, unique per page visit and metric.
   * CLS and INP can be reported more than once for the same instance as the
   * value grows, so the backend must dedupe on this and keep the last value —
   * summing reports would double-count every visit.
   */
  id: string;
  value: number;
  rating: VitalsRating;
  navigationType: VitalsNavigationType;
}

export interface LcpEvent extends VitalsEventBase {
  metric: "LCP";
  /** LCP's four subparts, which sum to `value`. */
  attribution: {
    /** CSS selector for the largest contentful element. */
    target?: string | undefined;
    /** Source URL when the LCP element is an image. */
    url?: string | undefined;
    timeToFirstByteMs: number;
    resourceLoadDelayMs: number;
    resourceLoadDurationMs: number;
    elementRenderDelayMs: number;
  };
}

export interface InpEvent extends VitalsEventBase {
  metric: "INP";
  /** INP's three phases, which sum to `value`. */
  attribution: {
    /** CSS selector for the element the user interacted with. */
    target?: string | undefined;
    interactionType?: "pointer" | "keyboard" | undefined;
    inputDelayMs: number;
    processingDurationMs: number;
    presentationDelayMs: number;
    /** Document load state when the interaction happened. */
    loadState: string;
  };
}

export interface ClsEvent extends VitalsEventBase {
  metric: "CLS";
  attribution: {
    /** CSS selector for the first element that moved in the largest shift. */
    target?: string | undefined;
    largestShiftValue: number;
    largestShiftTimeMs?: number | undefined;
    loadState?: string | undefined;
  };
}

export type VitalsEvent = LcpEvent | InpEvent | ClsEvent;

/**
 * Milliseconds, rounded to whole numbers.
 *
 * Sub-millisecond precision on a metric the browser itself rounds to 8ms for
 * privacy is noise, and every digit is bytes in a beacon that has a size limit.
 */
function ms(value: number): number {
  return Math.round(value);
}

/**
 * Layout shift scores are unitless and small — a *good* CLS is below 0.1 — so
 * whole numbers would collapse the entire good/poor range onto zero. Four
 * decimals keeps the resolution the thresholds are defined at.
 */
function score(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function toLcpEvent(metric: LCPMetricWithAttribution, context: VitalsContext): LcpEvent {
  const { attribution } = metric;
  return {
    ...context,
    metric: "LCP",
    id: metric.id,
    value: ms(metric.value),
    rating: metric.rating,
    navigationType: metric.navigationType,
    attribution: {
      target: attribution.target,
      url: attribution.url,
      timeToFirstByteMs: ms(attribution.timeToFirstByte),
      resourceLoadDelayMs: ms(attribution.resourceLoadDelay),
      resourceLoadDurationMs: ms(attribution.resourceLoadDuration),
      elementRenderDelayMs: ms(attribution.elementRenderDelay),
    },
  };
}

function toInpEvent(metric: INPMetricWithAttribution, context: VitalsContext): InpEvent {
  const { attribution } = metric;
  return {
    ...context,
    metric: "INP",
    id: metric.id,
    value: ms(metric.value),
    rating: metric.rating,
    navigationType: metric.navigationType,
    attribution: {
      target: attribution.interactionTarget,
      interactionType: attribution.interactionType,
      inputDelayMs: ms(attribution.inputDelay),
      processingDurationMs: ms(attribution.processingDuration),
      presentationDelayMs: ms(attribution.presentationDelay),
      loadState: attribution.loadState,
    },
  };
}

function toClsEvent(metric: CLSMetricWithAttribution, context: VitalsContext): ClsEvent {
  const { attribution } = metric;
  return {
    ...context,
    metric: "CLS",
    id: metric.id,
    value: score(metric.value),
    rating: metric.rating,
    navigationType: metric.navigationType,
    attribution: {
      target: attribution.largestShiftTarget,
      // A page with no layout shift at all reports CLS 0 with an empty
      // attribution, which is a real and common report rather than a gap.
      largestShiftValue: score(attribution.largestShiftValue ?? 0),
      largestShiftTimeMs:
        attribution.largestShiftTime === undefined ? undefined : ms(attribution.largestShiftTime),
      loadState: attribution.loadState,
    },
  };
}

/**
 * Shapes a metric for transport, or returns `null` for a metric this app does
 * not report.
 *
 * The `null` is not defensive: `MetricWithAttribution` covers all five metrics
 * the library can emit, so exhaustiveness here is what keeps a future
 * `onTTFB()` subscription from quietly shipping rows with an unexpected name.
 */
export function toVitalsEvent(
  metric: MetricWithAttribution,
  context: VitalsContext,
): VitalsEvent | null {
  switch (metric.name) {
    case "LCP":
      return toLcpEvent(metric, context);
    case "INP":
      return toInpEvent(metric, context);
    case "CLS":
      return toClsEvent(metric, context);
    case "FCP":
    case "TTFB":
      return null;
  }
}
