import { describe, it, expect } from "vitest";
import {
  formatVerdict,
  formatDetachedSummary,
  formatListenerDeltas,
  formatRetainerPath,
} from "./report.ts";
import { evaluateLeakSample } from "./leakVerdict.ts";
import { parseHeapSnapshot, findDetachedNodes, summarizeDetached } from "./heapSnapshot.ts";
import { buildHeapSnapshot } from "./snapshotFixture.ts";

describe("formatVerdict", () => {
  const verdict = evaluateLeakSample({
    baseline: { detachedNodes: 40, detachedBytes: 4_000, liveListeners: 30, detachedListeners: 0 },
    after: { detachedNodes: 90, detachedBytes: 9_000, liveListeners: 31, detachedListeners: 2 },
    policy: { iterations: 10, maxDetachedNodesPerIteration: 2, maxListenersPerIteration: 0.5 },
  });

  it("marks the failing rows and leaves the passing ones unmarked", () => {
    const text = formatVerdict(verdict);

    expect(text).toContain("! Detached DOM nodes");
    expect(text).toContain("  Live event listeners");
    expect(text).toContain("! Listeners on detached nodes");
  });

  it("prints the rate that was judged, not just the totals", () => {
    const text = formatVerdict(verdict);

    // Without this the reader cannot check the arithmetic, and "expected 90 to
    // be under 20" is the message that gets a memory gate switched off.
    expect(text).toContain("5.00/iter (max 2)");
    expect(text).toContain("+50");
    expect(text).toContain("10 iterations between samples");
  });

  it("carries the detached size as context", () => {
    expect(formatVerdict(verdict)).toContain("4.0 kB → 9.0 kB");
  });
});

describe("formatDetachedSummary", () => {
  const summary = summarizeDetached(
    findDetachedNodes(
      parseHeapSnapshot(
        buildHeapSnapshot([
          { type: "synthetic", name: "(GC roots)" },
          { type: "native", name: "Detached HTMLDivElement", selfSize: 120 },
          { type: "native", name: "Detached HTMLDivElement", selfSize: 120 },
          { type: "native", name: "Detached Text", selfSize: 40 },
        ]),
      ),
    ),
  );

  it("leads with the class that accumulated most", () => {
    const text = formatDetachedSummary(summary);

    expect(text).toContain("3 detached DOM nodes");
    expect(text.indexOf("HTMLDivElement")).toBeLessThan(text.indexOf("Text"));
  });

  it("truncates a long tail rather than printing every class", () => {
    expect(formatDetachedSummary(summary, 1)).toContain("… and 1 more classes");
  });

  it("says so plainly when there is nothing detached", () => {
    expect(formatDetachedSummary({ count: 0, selfSize: 0, bySpecies: [] })).toBe(
      "No detached DOM nodes.",
    );
  });
});

describe("formatListenerDeltas", () => {
  it("flags a delta whose target is out of the document", () => {
    const text = formatListenerDeltas([
      { target: "div#modal", type: "click", before: 0, after: 3, growth: 3, detached: true },
    ]);

    expect(text).toContain("+   3  div#modal → click  (0 → 3)  (target is detached)");
  });

  it("says so plainly when nothing moved", () => {
    expect(formatListenerDeltas([])).toBe("No listener registrations changed.");
  });
});

describe("formatRetainerPath", () => {
  it("indents each hop so the chain reads root-first", () => {
    const text = formatRetainerPath([
      { name: "(GC roots)", type: "synthetic", via: "shortcut window" },
      { name: "Window", type: "object", via: "internal listeners" },
    ]);

    expect(text.split("\n")).toEqual([
      "  (GC roots) [synthetic] --shortcut window-->",
      "   Window [object] --internal listeners-->",
    ]);
  });

  it("distinguishes 'no path' from 'the node is a root'", () => {
    expect(formatRetainerPath(null)).toContain("no retaining path found");
    expect(formatRetainerPath([])).toContain("is a GC root");
  });
});
