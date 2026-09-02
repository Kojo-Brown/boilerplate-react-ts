/**
 * Metric fixtures shaped exactly like the ones `web-vitals` emits.
 *
 * jsdom implements none of the entry types these metrics come from —
 * `largest-contentful-paint`, `event`, `layout-shift` — so a unit test can
 * never observe a real one. Building the library's own object types by hand is
 * what keeps that honest: if a future `web-vitals` renames an attribution
 * field, these fixtures stop compiling instead of quietly describing a shape
 * the browser no longer produces.
 */

import type {
  CLSAttribution,
  CLSMetricWithAttribution,
  INPAttribution,
  INPMetricWithAttribution,
  LCPAttribution,
  LCPMetricWithAttribution,
} from "web-vitals/attribution";

/**
 * Attribution overrides, where passing `undefined` means "the browser did not
 * report this field".
 *
 * `exactOptionalPropertyTypes` is on, so `Partial<T>` rejects an explicit
 * `undefined` — and an explicit `undefined` is exactly how a test says "this
 * LCP was a text node, so there is no resource URL".
 */
type AttributionOverrides<T> = { [K in keyof T]?: T[K] | undefined };

/**
 * Merges overrides in, deleting rather than blanking the keys set to
 * `undefined`, so the fixture has the same shape the library produces: an
 * unreported attribution field is absent, not present and empty. That is what
 * makes the assertion below sound.
 */
function mergeAttribution<T extends object>(defaults: T, overrides: AttributionOverrides<T>): T {
  const untouched = Object.entries(defaults as Record<string, unknown>).filter(
    ([key]) => !(key in overrides),
  );
  const replaced = Object.entries(overrides).filter(([, value]) => value !== undefined);
  return Object.fromEntries([...untouched, ...replaced]) as T;
}

interface MetricOverrides<TMetric, TAttribution> {
  metric?: Partial<TMetric>;
  attribution?: AttributionOverrides<TAttribution>;
}

export function makeLcpMetric(
  overrides: MetricOverrides<LCPMetricWithAttribution, LCPAttribution> = {},
): LCPMetricWithAttribution {
  return {
    name: "LCP",
    value: 2500.4,
    rating: "needs-improvement",
    delta: 2500.4,
    id: "v6-lcp-1",
    entries: [],
    navigationType: "navigate",
    navigationId: 1,
    ...overrides.metric,
    attribution: mergeAttribution(
      {
        target: "main>img.hero",
        url: "https://cdn.example.test/hero.avif",
        timeToFirstByte: 210.6,
        resourceLoadDelay: 40.2,
        resourceLoadDuration: 1800.9,
        elementRenderDelay: 448.7,
      },
      overrides.attribution ?? {},
    ),
  };
}

export function makeInpMetric(
  overrides: MetricOverrides<INPMetricWithAttribution, INPAttribution> = {},
): INPMetricWithAttribution {
  return {
    name: "INP",
    value: 312.6,
    rating: "poor",
    delta: 312.6,
    id: "v6-inp-1",
    entries: [],
    navigationType: "navigate",
    navigationId: 1,
    ...overrides.metric,
    attribution: mergeAttribution(
      {
        interactionTarget: "button#checkout",
        interactionType: "pointer" as const,
        inputDelay: 12.4,
        processingDuration: 280.1,
        presentationDelay: 20.1,
        loadState: "complete" as const,
        processedEventEntries: [],
        longAnimationFrameEntries: [],
      },
      overrides.attribution ?? {},
    ),
  };
}

export function makeClsMetric(
  overrides: MetricOverrides<CLSMetricWithAttribution, CLSAttribution> = {},
): CLSMetricWithAttribution {
  return {
    name: "CLS",
    value: 0.128_46,
    rating: "needs-improvement",
    delta: 0.128_46,
    id: "v6-cls-1",
    entries: [],
    navigationType: "navigate",
    navigationId: 1,
    ...overrides.metric,
    attribution: mergeAttribution(
      {
        largestShiftTarget: "div#banner",
        largestShiftValue: 0.102_37,
        largestShiftTime: 1420.8,
        loadState: "dom-interactive" as const,
      },
      overrides.attribution ?? {},
    ),
  };
}
