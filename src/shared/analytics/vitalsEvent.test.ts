import { describe, it, expect } from "vitest";
import { toVitalsEvent, type VitalsContext } from "@/shared/analytics/vitalsEvent";
import { makeClsMetric, makeInpMetric, makeLcpMetric } from "@/test/vitals";

const context: VitalsContext = {
  path: "/dashboard",
  visitId: "visit-1",
  reportedAt: 1_700_000_000_000,
};

describe("toVitalsEvent — LCP", () => {
  it("carries the value, rating and context", () => {
    const event = toVitalsEvent(makeLcpMetric(), context);

    expect(event).toMatchObject({
      metric: "LCP",
      id: "v6-lcp-1",
      value: 2500,
      rating: "needs-improvement",
      navigationType: "navigate",
      path: "/dashboard",
      visitId: "visit-1",
      reportedAt: 1_700_000_000_000,
    });
  });

  it("keeps the four subparts, which sum to the metric", () => {
    const event = toVitalsEvent(makeLcpMetric(), context);

    expect(event?.attribution).toEqual({
      target: "main>img.hero",
      url: "https://cdn.example.test/hero.avif",
      timeToFirstByteMs: 211,
      resourceLoadDelayMs: 40,
      resourceLoadDurationMs: 1801,
      elementRenderDelayMs: 449,
    });

    // 211 + 40 + 1801 + 449 = 2501 against a reported 2500: rounding each
    // subpart independently can shift the sum by a millisecond, which is why
    // the value is reported rather than reconstructed.
    expect(event?.value).toBe(2500);
  });

  it("omits the resource URL for a text LCP element", () => {
    const event = toVitalsEvent(
      makeLcpMetric({ attribution: { url: undefined, target: "h1" } }),
      context,
    );

    expect(event?.attribution).toMatchObject({ target: "h1", url: undefined });
  });

  it("drops the live performance entries", () => {
    const event = toVitalsEvent(makeLcpMetric(), context);

    expect(event).not.toHaveProperty("entries");
    // The round trip a beacon actually performs: nothing here serializes to
    // `{}` or drags a `PerformanceNavigationTiming` along with it.
    expect(JSON.parse(JSON.stringify(event))).toEqual(event);
  });
});

describe("toVitalsEvent — INP", () => {
  it("keeps the three interaction phases and the target", () => {
    const event = toVitalsEvent(makeInpMetric(), context);

    expect(event).toMatchObject({ metric: "INP", value: 313, rating: "poor" });
    expect(event?.attribution).toEqual({
      target: "button#checkout",
      interactionType: "pointer",
      inputDelayMs: 12,
      processingDurationMs: 280,
      presentationDelayMs: 20,
      loadState: "complete",
    });
  });

  it("survives an interaction whose element left the DOM", () => {
    const event = toVitalsEvent(
      makeInpMetric({
        attribution: { interactionTarget: undefined, interactionType: undefined },
      }),
      context,
    );

    expect(event?.attribution).toMatchObject({ target: undefined, interactionType: undefined });
  });

  it("never ships the processed event entries", () => {
    const event = toVitalsEvent(makeInpMetric(), context);

    expect(event?.attribution).not.toHaveProperty("processedEventEntries");
    expect(event?.attribution).not.toHaveProperty("longAnimationFrameEntries");
  });
});

describe("toVitalsEvent — CLS", () => {
  it("keeps four decimals rather than rounding a score to zero", () => {
    const event = toVitalsEvent(makeClsMetric(), context);

    expect(event).toMatchObject({ metric: "CLS", value: 0.1285 });
    expect(event?.attribution).toEqual({
      target: "div#banner",
      largestShiftValue: 0.1024,
      largestShiftTimeMs: 1421,
      loadState: "dom-interactive",
    });
  });

  it("reports a perfectly stable page as a real zero", () => {
    const event = toVitalsEvent(
      makeClsMetric({
        metric: { value: 0, rating: "good" },
        attribution: {
          largestShiftTarget: undefined,
          largestShiftValue: undefined,
          largestShiftTime: undefined,
          loadState: undefined,
        },
      }),
      context,
    );

    expect(event).toMatchObject({ metric: "CLS", value: 0, rating: "good" });
    expect(event?.attribution).toEqual({
      target: undefined,
      largestShiftValue: 0,
      largestShiftTimeMs: undefined,
      loadState: undefined,
    });
  });
});

describe("toVitalsEvent — metrics this app does not report", () => {
  it("returns null for FCP and TTFB", () => {
    const fcp = toVitalsEvent(
      {
        name: "FCP",
        value: 1200,
        rating: "good",
        delta: 1200,
        id: "v6-fcp-1",
        entries: [],
        navigationType: "navigate",
        navigationId: 1,
        attribution: { timeToFirstByte: 200, firstByteToFCP: 1000, loadState: "loading" },
      },
      context,
    );

    expect(fcp).toBeNull();
  });
});

describe("toVitalsEvent — navigation type", () => {
  it("preserves a back/forward-cache restore", () => {
    // A bfcache restore starts a *new* metric instance with a new id, so the
    // navigation type is the only thing distinguishing it from a fresh load —
    // and its LCP is normally near-zero, which skews any table that mixes them.
    const event = toVitalsEvent(
      makeLcpMetric({ metric: { navigationType: "back-forward-cache", id: "v6-lcp-2" } }),
      context,
    );

    expect(event).toMatchObject({ id: "v6-lcp-2", navigationType: "back-forward-cache" });
  });
});
