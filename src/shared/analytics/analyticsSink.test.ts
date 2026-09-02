import { describe, it, expect, vi, afterEach } from "vitest";
import {
  beaconTransport,
  createBeaconSink,
  createConsoleSink,
  createMemorySink,
  createSinkFromEnv,
  flushOnHidden,
  type AnalyticsTransport,
  type VitalsPayload,
} from "@/shared/analytics/analyticsSink";
import { toVitalsEvent, type VitalsEvent } from "@/shared/analytics/vitalsEvent";
import { makeClsMetric, makeInpMetric, makeLcpMetric } from "@/test/vitals";

const context = { path: "/", visitId: "visit-1", reportedAt: 1_700_000_000_000 };

function event(metric: "LCP" | "INP" | "CLS", id: string, value?: number): VitalsEvent {
  const make = { LCP: makeLcpMetric, INP: makeInpMetric, CLS: makeClsMetric }[metric];
  const shaped = toVitalsEvent(
    make({ metric: value === undefined ? { id } : { id, value } }),
    context,
  );
  if (!shaped) throw new Error(`${metric} did not shape into an event`);
  return shaped;
}

function recordingTransport(result = true) {
  const sent: { endpoint: string; payload: VitalsPayload }[] = [];
  const transport: AnalyticsTransport = (endpoint, body) => {
    sent.push({ endpoint, payload: JSON.parse(body) as VitalsPayload });
    return result;
  };
  return { transport, sent };
}

describe("createBeaconSink", () => {
  it("sends nothing until flushed", () => {
    const { transport, sent } = recordingTransport();
    const sink = createBeaconSink({ endpoint: "/__vitals", transport });

    sink.record(event("LCP", "lcp-1"));
    expect(sent).toHaveLength(0);

    sink.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.endpoint).toBe("/__vitals");
    expect(sent[0]?.payload.events).toHaveLength(1);
  });

  it("batches every queued metric into one request", () => {
    const { transport, sent } = recordingTransport();
    const sink = createBeaconSink({ endpoint: "/__vitals", transport });

    sink.record(event("LCP", "lcp-1"));
    sink.record(event("INP", "inp-1"));
    sink.record(event("CLS", "cls-1"));
    sink.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload.events.map((e) => e.metric)).toEqual(["LCP", "INP", "CLS"]);
  });

  it("keeps only the last report of a metric instance", () => {
    const { transport, sent } = recordingTransport();
    const sink = createBeaconSink({ endpoint: "/__vitals", transport });

    // What `onINP` actually does: the same instance re-reported as the value
    // grows. Appending both would make any backend that counts or sums wrong.
    sink.record(event("INP", "inp-1", 120));
    sink.record(event("INP", "inp-1", 340));
    sink.flush();

    expect(sent[0]?.payload.events).toHaveLength(1);
    expect(sent[0]?.payload.events[0]?.value).toBe(340);
  });

  it("does not send an empty batch", () => {
    const { transport, sent } = recordingTransport();
    const sink = createBeaconSink({ endpoint: "/__vitals", transport });

    sink.flush();
    sink.flush();

    expect(sent).toHaveLength(0);
  });

  it("clears the queue after a flush", () => {
    const { transport, sent } = recordingTransport();
    const sink = createBeaconSink({ endpoint: "/__vitals", transport });

    sink.record(event("LCP", "lcp-1"));
    sink.flush();
    sink.record(event("CLS", "cls-1"));
    sink.flush();

    expect(sent.map((request) => request.payload.events.map((e) => e.id))).toEqual([
      ["lcp-1"],
      ["cls-1"],
    ]);
  });

  it("drops a rejected batch instead of resending it", () => {
    const { transport, sent } = recordingTransport(false);
    const sink = createBeaconSink({ endpoint: "/__vitals", transport });

    sink.record(event("LCP", "lcp-1"));
    sink.flush();
    sink.flush();

    expect(sent).toHaveLength(1);
  });

  it("flushes early once the queue reaches its cap", () => {
    const { transport, sent } = recordingTransport();
    const sink = createBeaconSink({ endpoint: "/__vitals", transport, maxQueuedEvents: 2 });

    sink.record(event("LCP", "lcp-1"));
    expect(sent).toHaveLength(0);
    sink.record(event("INP", "inp-1"));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload.events).toHaveLength(2);
  });

  it("swallows a throwing transport", () => {
    const sink = createBeaconSink({
      endpoint: "/__vitals",
      transport: () => {
        throw new Error("network is down");
      },
    });

    sink.record(event("LCP", "lcp-1"));
    expect(() => {
      sink.flush();
    }).not.toThrow();
  });
});

describe("beaconTransport", () => {
  /**
   * jsdom implements neither `navigator.sendBeacon` nor a real `fetch`, so both
   * are installed for the duration of a test. What is being checked is the
   * order of the ladder — the real transport is exercised end to end in
   * `e2e/web-vitals.spec.ts`.
   */
  function withSendBeacon(implementation: ((url: string, body: string) => boolean) | null): void {
    if (implementation === null) {
      Reflect.deleteProperty(navigator, "sendBeacon");
      return;
    }
    Object.defineProperty(navigator, "sendBeacon", {
      value: implementation,
      configurable: true,
      writable: true,
    });
  }

  afterEach(() => {
    withSendBeacon(null);
    vi.unstubAllGlobals();
  });

  it("prefers sendBeacon, which is the request specified to outlive the page", () => {
    const sendBeacon = vi.fn(() => true);
    const fetchSpy = vi.fn();
    withSendBeacon(sendBeacon);
    vi.stubGlobal("fetch", fetchSpy);

    expect(beaconTransport("/__vitals", '{"events":[]}')).toBe(true);
    expect(sendBeacon).toHaveBeenCalledWith("/__vitals", '{"events":[]}');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to keepalive fetch when the beacon queue refuses the payload", () => {
    withSendBeacon(() => false);
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchSpy);

    expect(beaconTransport("/__vitals", "payload")).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith("/__vitals", {
      method: "POST",
      body: "payload",
      keepalive: true,
    });
  });

  it("falls back to fetch where sendBeacon does not exist at all", () => {
    withSendBeacon(null);
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchSpy);

    expect(beaconTransport("/__vitals", "payload")).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not surface a rejected send as an unhandled rejection", async () => {
    withSendBeacon(() => false);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network is down"))),
    );

    expect(beaconTransport("/__vitals", "payload")).toBe(true);
    // A rejection handled a microtask later would still fail the run; letting
    // the queue drain here is what proves the `.catch` is attached.
    await Promise.resolve();
  });

  it("reports failure when nothing can send", () => {
    withSendBeacon(() => false);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("no fetch here");
      }),
    );

    expect(beaconTransport("/__vitals", "payload")).toBe(false);
  });
});

describe("createConsoleSink", () => {
  it("logs each metric with its route", () => {
    const info = vi.fn();
    const sink = createConsoleSink({ info });

    const lcp = event("LCP", "lcp-1");
    sink.record(lcp);

    expect(info).toHaveBeenCalledWith(
      "[web-vitals] LCP 2500 (needs-improvement) on /",
      expect.objectContaining({ id: "lcp-1" }),
    );
  });
});

describe("createMemorySink", () => {
  it("records events and groups them into flushed batches", () => {
    const sink = createMemorySink();

    sink.record(event("LCP", "lcp-1"));
    sink.record(event("INP", "inp-1"));
    sink.flush();
    sink.flush();
    sink.record(event("CLS", "cls-1"));
    sink.flush();

    expect(sink.events.map((e) => e.id)).toEqual(["lcp-1", "inp-1", "cls-1"]);
    expect(sink.batches.map((batch) => batch.map((e) => e.id))).toEqual([
      ["lcp-1", "inp-1"],
      ["cls-1"],
    ]);
  });
});

describe("createSinkFromEnv", () => {
  it("beacons to the configured endpoint", () => {
    const { transport, sent } = recordingTransport();
    const sink = createSinkFromEnv({ endpoint: "/__vitals", dev: false, transport });

    sink?.record(event("LCP", "lcp-1"));
    sink?.flush();

    expect(sent).toHaveLength(1);
  });

  it("falls back to the console in development", () => {
    const sink = createSinkFromEnv({ endpoint: "", dev: true });

    expect(sink).not.toBeNull();
  });

  it("returns null when unconfigured, so nothing subscribes", () => {
    expect(createSinkFromEnv({ endpoint: "", dev: false })).toBeNull();
  });
});

describe("flushOnHidden", () => {
  function harness() {
    const listeners = new Map<string, () => void>();
    const target = {
      addEventListener: (type: string, listener: () => void) => {
        listeners.set(type, listener);
      },
      removeEventListener: (type: string) => {
        listeners.delete(type);
      },
    };
    return { listeners, doc: target, win: target };
  }

  it("flushes when the page is hidden", () => {
    const sink = createMemorySink();
    const { listeners, doc, win } = harness();
    let hidden = false;

    flushOnHidden(sink, { doc, win, isHidden: () => hidden });
    sink.record(event("LCP", "lcp-1"));

    // A tab that becomes visible again is not the end of the visit.
    listeners.get("visibilitychange")?.();
    expect(sink.batches).toHaveLength(0);

    hidden = true;
    listeners.get("visibilitychange")?.();
    expect(sink.batches.map((batch) => batch.map((e) => e.id))).toEqual([["lcp-1"]]);
  });

  it("flushes on pagehide, which a bfcache navigation reaches without hiding", () => {
    const sink = createMemorySink();
    const { listeners, doc, win } = harness();

    flushOnHidden(sink, { doc, win, isHidden: () => false });
    sink.record(event("CLS", "cls-1"));
    listeners.get("pagehide")?.();

    expect(sink.batches).toHaveLength(1);
  });

  it("detaches both listeners when disposed", () => {
    const sink = createMemorySink();
    const { listeners, doc, win } = harness();

    const dispose = flushOnHidden(sink, { doc, win, isHidden: () => true });
    expect([...listeners.keys()].sort()).toEqual(["pagehide", "visibilitychange"]);

    dispose();
    expect(listeners.size).toBe(0);
  });
});
