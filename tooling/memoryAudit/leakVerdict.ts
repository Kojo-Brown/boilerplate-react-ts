/**
 * Turning two measurements into a pass or a fail.
 *
 * The whole method rests on one decision, and it is not the threshold — it is
 * what the threshold is applied to.
 *
 * **Not an absolute count.** A freshly loaded page has detached nodes in it:
 * React's own reconciliation, the router's popstate bookkeeping and Chromium's
 * font and style machinery all hold onto a handful, and the number differs
 * between Chrome versions and between a warm and a cold profile. A gate that
 * asserts zero fails on correct code, gets a `+ 20` slack added to it, and
 * then never fails again.
 *
 * **Growth between two equal batches of the same journey.** Run the journey
 * once to warm up, measure, run it *N* more times, measure again. Anything
 * one-off — the route chunk, the query cache, the font — is paid for in the
 * warm-up and cancels out. What survives is per-iteration growth, which is
 * exactly what a leak is and what a correctly-cleaned-up component is not.
 *
 * The unit of the threshold is therefore *nodes per iteration*, and a sensible
 * value for it is a small integer rather than a percentage of anything.
 */

/** One measurement of the page, taken after a forced collection. */
export interface LeakSample {
  /** Detached DOM nodes in the heap snapshot. */
  readonly detachedNodes: number;
  /** Their combined shallow size, in bytes. Context for the report. */
  readonly detachedBytes: number;
  /** Live `addEventListener` registrations the probe is tracking. */
  readonly liveListeners: number;
  /** The subset of those registered on nodes out of the document. */
  readonly detachedListeners: number;
}

export interface LeakPolicy {
  /** Journey repetitions between the two samples. Must be at least 1. */
  readonly iterations: number;
  /** Detached nodes one iteration may add. */
  readonly maxDetachedNodesPerIteration: number;
  /** Listener registrations one iteration may add. */
  readonly maxListenersPerIteration: number;
  /**
   * Listeners allowed to remain on detached nodes, in absolute terms.
   *
   * Absolute rather than per-iteration because there is no benign reason for
   * one: a listener on a node that is out of the document is either a teardown
   * that did not run, or a node that has not been collected *because* of the
   * listener. Defaults to 0.
   */
  readonly maxDetachedListeners?: number;
}

export type LeakStatus = "ok" | "over";

export interface LeakFinding {
  /** Stable id, so a failure message can be grepped for. */
  readonly metric: "detachedNodes" | "liveListeners" | "detachedListeners";
  readonly label: string;
  readonly before: number;
  readonly after: number;
  readonly growth: number;
  /** Growth divided by iterations. `null` for an absolute-limit metric. */
  readonly perIteration: number | null;
  /** The ceiling this was judged against, in the same unit as `perIteration`. */
  readonly allowed: number;
  readonly status: LeakStatus;
}

export interface LeakVerdict {
  readonly iterations: number;
  readonly findings: readonly LeakFinding[];
  readonly failed: boolean;
  /** Detached bytes at the two samples, for the report's context line. */
  readonly detachedBytes: { readonly before: number; readonly after: number };
}

/**
 * Judges an after-sample against a baseline.
 *
 * Every metric is reported, passing or not. A gate that prints only its
 * failures gives you nothing to compare against when it starts failing, and
 * "detached nodes went from 12 to 13 over 20 iterations" is the line that
 * tells a reviewer the measurement is working at all.
 */
export function evaluateLeakSample(input: {
  baseline: LeakSample;
  after: LeakSample;
  policy: LeakPolicy;
}): LeakVerdict {
  const { baseline, after, policy } = input;
  if (!Number.isInteger(policy.iterations) || policy.iterations < 1) {
    throw new Error(`Leak policy needs at least 1 iteration, got ${String(policy.iterations)}.`);
  }

  const perIterationFinding = (
    metric: "detachedNodes" | "liveListeners",
    label: string,
    before: number,
    afterValue: number,
    allowed: number,
  ): LeakFinding => {
    const growth = afterValue - before;
    const perIteration = growth / policy.iterations;
    return {
      metric,
      label,
      before,
      after: afterValue,
      growth,
      perIteration,
      allowed,
      status: perIteration > allowed ? "over" : "ok",
    };
  };

  const detachedListenerLimit = policy.maxDetachedListeners ?? 0;

  const findings: LeakFinding[] = [
    perIterationFinding(
      "detachedNodes",
      "Detached DOM nodes",
      baseline.detachedNodes,
      after.detachedNodes,
      policy.maxDetachedNodesPerIteration,
    ),
    perIterationFinding(
      "liveListeners",
      "Live event listeners",
      baseline.liveListeners,
      after.liveListeners,
      policy.maxListenersPerIteration,
    ),
    {
      metric: "detachedListeners",
      label: "Listeners on detached nodes",
      before: baseline.detachedListeners,
      after: after.detachedListeners,
      growth: after.detachedListeners - baseline.detachedListeners,
      perIteration: null,
      allowed: detachedListenerLimit,
      status: after.detachedListeners > detachedListenerLimit ? "over" : "ok",
    },
  ];

  return {
    iterations: policy.iterations,
    findings,
    failed: findings.some((finding) => finding.status === "over"),
    detachedBytes: { before: baseline.detachedBytes, after: after.detachedBytes },
  };
}
