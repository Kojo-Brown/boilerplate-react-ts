import { describe, it, expect, vi } from "vitest";
import {
  isSampledIn,
  startVitalsCollection,
  webVitalsSubscriptions,
  type VitalsListener,
  type VitalsSubscriptions,
} from "@/shared/analytics/vitalsCollector";
import { createMemorySink } from "@/shared/analytics/analyticsSink";
import { makeClsMetric, makeInpMetric, makeLcpMetric } from "@/test/vitals";

/**
 * A stand-in for the three `web-vitals` entry points that records how often it
 * was subscribed to and can emit metrics on demand.
 */
function fakeSubscriptions() {
  const reporters: VitalsListener[] = [];
  const subscribeCounts = { onCLS: 0, onINP: 0, onLCP: 0 };

  const subscriptions: VitalsSubscriptions = {
    onCLS: (report) => {
      subscribeCounts.onCLS += 1;
      reporters.push(report);
    },
    onINP: (report) => {
      subscribeCounts.onINP += 1;
      reporters.push(report);
    },
    onLCP: (report) => {
      subscribeCounts.onLCP += 1;
      reporters.push(report);
    },
  };

  return {
    subscriptions,
    subscribeCounts,
    /** Emits a metric the way the library would, to whoever is bound. */
    emit(metric: Parameters<VitalsListener>[0]): void {
      // Every entry point funnels into the same dispatcher, so emitting once
      // through the first reporter is what the library does for one metric.
      reporters[0]?.(metric);
    },
  };
}

describe("isSampledIn", () => {
  it("takes every visit at a rate of 1 without consulting the RNG", () => {
    const random = vi.fn(() => 0.99);
    expect(isSampledIn(1, random)).toBe(true);
    expect(random).not.toHaveBeenCalled();
  });

  it("takes no visit at a rate of 0", () => {
    expect(isSampledIn(0, () => 0)).toBe(false);
  });

  it("compares the roll against the rate", () => {
    expect(isSampledIn(0.1, () => 0.09)).toBe(true);
    expect(isSampledIn(0.1, () => 0.1)).toBe(false);
  });

  it("treats an unparseable rate as off rather than as everything", () => {
    expect(isSampledIn(Number.NaN, () => 0)).toBe(false);
  });
});

describe("startVitalsCollection", () => {
  it("reports each Core Web Vital to the sink", () => {
    const sink = createMemorySink();
    const { subscriptions, emit } = fakeSubscriptions();

    startVitalsCollection({ sink, subscriptions, newVisitId: () => "visit-1", now: () => 1_000 });

    emit(makeLcpMetric());
    emit(makeInpMetric());
    emit(makeClsMetric());

    expect(sink.events.map((e) => e.metric)).toEqual(["LCP", "INP", "CLS"]);
    expect(sink.events.map((e) => e.visitId)).toEqual(["visit-1", "visit-1", "visit-1"]);
    expect(sink.events.every((e) => e.reportedAt === 1_000)).toBe(true);
  });

  it("subscribes to each entry point exactly once, however many collectors start", () => {
    const sink = createMemorySink();
    const { subscriptions, subscribeCounts, emit } = fakeSubscriptions();

    // What StrictMode's mount → unmount → mount does. `onLCP` and friends
    // install a PerformanceObserver that cannot be removed, so a second
    // subscription would report every metric twice for the rest of the page.
    const stopFirst = startVitalsCollection({ sink, subscriptions });
    stopFirst();
    startVitalsCollection({ sink, subscriptions, newVisitId: () => "visit-2" });

    expect(subscribeCounts).toEqual({ onCLS: 1, onINP: 1, onLCP: 1 });

    emit(makeLcpMetric());
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]?.visitId).toBe("visit-2");
  });

  it("fans a metric out to every live collector", () => {
    const first = createMemorySink();
    const second = createMemorySink();
    const { subscriptions, emit } = fakeSubscriptions();

    startVitalsCollection({ sink: first, subscriptions });
    startVitalsCollection({ sink: second, subscriptions });
    emit(makeLcpMetric());

    expect(first.events).toHaveLength(1);
    expect(second.events).toHaveLength(1);
  });

  it("stops reporting once stopped", () => {
    const sink = createMemorySink();
    const { subscriptions, emit } = fakeSubscriptions();

    const stop = startVitalsCollection({ sink, subscriptions });
    emit(makeLcpMetric());
    stop();
    emit(makeInpMetric());

    expect(sink.events.map((e) => e.metric)).toEqual(["LCP"]);
  });

  it("survives a listener that stops itself while being called", () => {
    const sink = createMemorySink();
    const { subscriptions, emit } = fakeSubscriptions();

    const selfRemoving: { stop?: () => void } = {};
    selfRemoving.stop = startVitalsCollection({
      sink: {
        record: () => {
          selfRemoving.stop?.();
        },
        flush: () => undefined,
      },
      subscriptions,
    });
    startVitalsCollection({ sink, subscriptions });

    expect(() => {
      emit(makeLcpMetric());
    }).not.toThrow();
    expect(sink.events).toHaveLength(1);
  });

  it("attributes a metric to the route showing when it was reported", () => {
    const sink = createMemorySink();
    const { subscriptions, emit } = fakeSubscriptions();
    let path = "/";

    startVitalsCollection({ sink, subscriptions, getPath: () => path });

    emit(makeLcpMetric());
    path = "/dashboard";
    // INP is finalised at page hide, by which time an SPA has usually moved on.
    emit(makeInpMetric());

    expect(sink.events.map((e) => e.path)).toEqual(["/", "/dashboard"]);
  });

  it("ignores metrics this app does not report", () => {
    const sink = createMemorySink();
    const { subscriptions, emit } = fakeSubscriptions();

    startVitalsCollection({ sink, subscriptions });
    emit({
      name: "TTFB",
      value: 180,
      rating: "good",
      delta: 180,
      id: "v6-ttfb-1",
      entries: [],
      navigationType: "navigate",
      navigationId: 1,
      attribution: {
        waitingDuration: 10,
        cacheDuration: 0,
        dnsDuration: 20,
        connectionDuration: 30,
        requestDuration: 120,
      },
    });

    expect(sink.events).toHaveLength(0);
  });

  it("subscribes to nothing when the visit is outside the sample", () => {
    const sink = createMemorySink();
    const { subscriptions, subscribeCounts, emit } = fakeSubscriptions();

    const stop = startVitalsCollection({
      sink,
      subscriptions,
      sampleRate: 0.1,
      random: () => 0.5,
    });

    expect(subscribeCounts).toEqual({ onCLS: 0, onINP: 0, onLCP: 0 });
    emit(makeLcpMetric());
    expect(sink.events).toHaveLength(0);
    expect(() => {
      stop();
    }).not.toThrow();
  });

  it("keeps a sampled-in visit's metrics together", () => {
    const sink = createMemorySink();
    const { subscriptions, emit } = fakeSubscriptions();

    // One roll for the visit, not one per metric: a visit that reports its LCP
    // and drops its INP cannot answer whether slow loads also respond slowly.
    const random = vi.fn(() => 0.05);
    startVitalsCollection({ sink, subscriptions, sampleRate: 0.1, random });

    emit(makeLcpMetric());
    emit(makeInpMetric());
    emit(makeClsMetric());

    expect(random).toHaveBeenCalledTimes(1);
    expect(sink.events).toHaveLength(3);
  });
});

describe("webVitalsSubscriptions", () => {
  it("binds the real library's three Core Web Vitals entry points", () => {
    expect(Object.keys(webVitalsSubscriptions).sort()).toEqual(["onCLS", "onINP", "onLCP"]);
    expect(typeof webVitalsSubscriptions.onLCP).toBe("function");
  });
});
