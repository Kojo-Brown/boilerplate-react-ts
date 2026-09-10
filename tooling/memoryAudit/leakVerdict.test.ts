import { describe, it, expect } from "vitest";
import { evaluateLeakSample, type LeakSample, type LeakPolicy } from "./leakVerdict.ts";

const POLICY: LeakPolicy = {
  iterations: 10,
  maxDetachedNodesPerIteration: 2,
  maxListenersPerIteration: 0.5,
};

const sample = (overrides: Partial<LeakSample> = {}): LeakSample => ({
  detachedNodes: 40,
  detachedBytes: 4_000,
  liveListeners: 30,
  detachedListeners: 0,
  ...overrides,
});

const finding = (
  verdict: ReturnType<typeof evaluateLeakSample>,
  metric: "detachedNodes" | "detachedNodesTotal" | "liveListeners" | "detachedListeners",
) => verdict.findings.find((entry) => entry.metric === metric);

describe("evaluateLeakSample", () => {
  it("passes a page whose detached population is flat across iterations", () => {
    const verdict = evaluateLeakSample({
      baseline: sample(),
      after: sample({ detachedNodes: 44, detachedBytes: 4_400 }),
      policy: POLICY,
    });

    expect(verdict.failed).toBe(false);
    expect(finding(verdict, "detachedNodes")).toMatchObject({
      growth: 4,
      perIteration: 0.4,
      status: "ok",
    });
  });

  it("fails on growth per iteration, not on the absolute count", () => {
    // 400 detached nodes and no growth is a page that starts with 400 detached
    // nodes — noisy, but not leaking. 40 → 61 over ten iterations is.
    const flatButLarge = evaluateLeakSample({
      baseline: sample({ detachedNodes: 400 }),
      after: sample({ detachedNodes: 405 }),
      policy: POLICY,
    });
    const smallButGrowing = evaluateLeakSample({
      baseline: sample({ detachedNodes: 40 }),
      after: sample({ detachedNodes: 61 }),
      policy: POLICY,
    });

    expect(flatButLarge.failed).toBe(false);
    expect(smallButGrowing.failed).toBe(true);
    expect(finding(smallButGrowing, "detachedNodes")).toMatchObject({
      perIteration: 2.1,
      allowed: 2,
      status: "over",
    });
  });

  it("treats the ceiling as inclusive", () => {
    const verdict = evaluateLeakSample({
      baseline: sample(),
      after: sample({ detachedNodes: 60 }),
      policy: POLICY,
    });

    expect(finding(verdict, "detachedNodes")).toMatchObject({ perIteration: 2, status: "ok" });
  });

  it("fails a listener count that climbs with every iteration", () => {
    const verdict = evaluateLeakSample({
      baseline: sample({ liveListeners: 30 }),
      after: sample({ liveListeners: 40 }),
      policy: POLICY,
    });

    expect(verdict.failed).toBe(true);
    expect(finding(verdict, "liveListeners")).toMatchObject({
      growth: 10,
      perIteration: 1,
      allowed: 0.5,
      status: "over",
    });
  });

  it("fails any listener still bound to a node out of the document", () => {
    const verdict = evaluateLeakSample({
      baseline: sample(),
      after: sample({ detachedListeners: 1 }),
      policy: POLICY,
    });

    expect(verdict.failed).toBe(true);
    // Absolute, not per-iteration: one is already a teardown that did not run.
    expect(finding(verdict, "detachedListeners")).toMatchObject({
      perIteration: null,
      allowed: 0,
      status: "over",
    });
  });

  it("allows a detached-listener budget to be raised deliberately", () => {
    const verdict = evaluateLeakSample({
      baseline: sample(),
      after: sample({ detachedListeners: 2 }),
      policy: { ...POLICY, maxDetachedListeners: 2 },
    });

    expect(verdict.failed).toBe(false);
  });

  it("judges an absolute ceiling on the after sample, ignoring the rate", () => {
    // The popup journey's shape: a large, bounded quantum that steps up and
    // down between samples. 29 → 55 is +2.6/iter, which a rate ceiling of 1
    // fails and which says nothing about whether anything is accumulating.
    const policy = {
      ...POLICY,
      maxDetachedNodesPerIteration: null,
      maxDetachedNodes: 104,
    };

    const bounded = evaluateLeakSample({
      baseline: sample({ detachedNodes: 29 }),
      after: sample({ detachedNodes: 55 }),
      policy,
    });
    const leaking = evaluateLeakSample({
      baseline: sample({ detachedNodes: 29 }),
      after: sample({ detachedNodes: 290 }),
      policy,
    });

    expect(bounded.failed).toBe(false);
    expect(leaking.failed).toBe(true);
    expect(finding(bounded, "detachedNodes")).toBeUndefined();
    expect(finding(bounded, "detachedNodesTotal")).toMatchObject({
      after: 55,
      growth: 26,
      perIteration: null,
      allowed: 104,
      status: "ok",
    });
  });

  it("can judge both a rate and an absolute ceiling at once", () => {
    const verdict = evaluateLeakSample({
      baseline: sample({ detachedNodes: 40 }),
      after: sample({ detachedNodes: 44 }),
      policy: { ...POLICY, maxDetachedNodes: 42 },
    });

    expect(finding(verdict, "detachedNodes")?.status).toBe("ok");
    expect(finding(verdict, "detachedNodesTotal")?.status).toBe("over");
    expect(verdict.failed).toBe(true);
  });

  it("refuses a policy that judges the detached count by nothing at all", () => {
    // Both ceilings off leaves the count unjudged while the report still
    // prints it, which reads exactly like a passing gate.
    expect(() =>
      evaluateLeakSample({
        baseline: sample(),
        after: sample(),
        policy: { ...POLICY, maxDetachedNodesPerIteration: null },
      }),
    ).toThrow(/rate, an absolute ceiling, or both/);
  });

  it("reports every metric, including the passing ones", () => {
    const verdict = evaluateLeakSample({
      baseline: sample(),
      after: sample({ detachedNodes: 200 }),
      policy: POLICY,
    });

    // The failure message is the diagnosis: a reader needs the two metrics
    // that did *not* move to tell a leak from a mis-measurement.
    expect(verdict.findings.map((entry) => entry.metric)).toEqual([
      "detachedNodes",
      "liveListeners",
      "detachedListeners",
    ]);
    expect(verdict.detachedBytes).toEqual({ before: 4_000, after: 4_000 });
  });

  it("refuses a policy with no iterations to divide by", () => {
    expect(() =>
      evaluateLeakSample({
        baseline: sample(),
        after: sample(),
        policy: { ...POLICY, iterations: 0 },
      }),
    ).toThrow(/at least 1 iteration/);
  });
});
