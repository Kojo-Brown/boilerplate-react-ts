/**
 * The React binding: mounts the collector once and tells it which route a
 * metric belongs to.
 *
 * It renders nothing. Everything it does is a subscription, and putting it in
 * the tree rather than in `main.tsx` is what gives it access to the router —
 * a Core Web Vital reported without a route is a number no one can act on,
 * because the fix is always in a particular screen.
 */

import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { env } from "@/shared/config/env";
import { createSinkFromEnv, flushOnHidden } from "@/shared/analytics/analyticsSink";
import type { AnalyticsSink } from "@/shared/analytics/analyticsSink";
import { startVitalsCollection } from "@/shared/analytics/vitalsCollector";

let envSink: AnalyticsSink | null = null;
let envSinkResolved = false;

/**
 * The configured sink, resolved once.
 *
 * Memoized because the sink owns the batch queue: a new one per mount would
 * hold rows that the flush at page hide never sees.
 */
function defaultSink(): AnalyticsSink | null {
  if (!envSinkResolved) {
    envSink = createSinkFromEnv({
      endpoint: env.VITE_ANALYTICS_URL,
      // Console logging is a development affordance, so it follows the devtools
      // switch rather than `import.meta.env.DEV` alone — otherwise every unit
      // test that renders the app shell would log three metrics.
      dev: import.meta.env.DEV && env.VITE_ENABLE_DEVTOOLS,
    });
    envSinkResolved = true;
  }
  return envSink;
}

export interface WebVitalsReporterProps {
  /**
   * Overrides the sink chosen from `VITE_ANALYTICS_URL`. Passing `null`
   * disables reporting outright, which is distinct from omitting the prop.
   */
  sink?: AnalyticsSink | null;
  /** Overrides `VITE_VITALS_SAMPLE_RATE`. */
  sampleRate?: number;
}

export function WebVitalsReporter({ sink, sampleRate }: WebVitalsReporterProps = {}) {
  const location = useLocation();
  const pathRef = useRef(location.pathname);

  // Written in an effect rather than during render: a ref mutated while
  // rendering is a Rules of React violation, and there is no urgency here —
  // every metric this feeds arrives long after paint.
  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  const resolvedSink = sink === undefined ? defaultSink() : sink;
  const resolvedSampleRate = sampleRate ?? env.VITE_VITALS_SAMPLE_RATE;

  useEffect(() => {
    if (!resolvedSink) return;

    const stopFlushing = flushOnHidden(resolvedSink);
    const stopCollecting = startVitalsCollection({
      sink: resolvedSink,
      sampleRate: resolvedSampleRate,
      getPath: () => pathRef.current,
    });

    return () => {
      stopCollecting();
      stopFlushing();
    };
  }, [resolvedSink, resolvedSampleRate]);

  return null;
}
