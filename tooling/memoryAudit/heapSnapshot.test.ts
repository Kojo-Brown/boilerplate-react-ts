import { describe, it, expect } from "vitest";
import {
  parseHeapSnapshot,
  findDetachedNodes,
  summarizeDetached,
  shortestRetainerPath,
} from "./heapSnapshot.ts";
import { buildHeapSnapshot, type FixtureNode } from "./snapshotFixture.ts";

/** A root, a window, and a detached div the window retains through a closure. */
const LEAKY_PAGE: FixtureNode[] = [
  { type: "synthetic", name: "(GC roots)", edges: [{ type: "shortcut", name: "window", to: 1 }] },
  {
    name: "Window",
    selfSize: 64,
    edges: [
      { type: "internal", name: "listeners", to: 2 },
      { type: "property", name: "unrelated", to: 5 },
    ],
  },
  {
    type: "array",
    name: "EventListener",
    selfSize: 32,
    edges: [{ type: "element", name: "0", to: 3 }],
  },
  {
    type: "closure",
    name: "onResize",
    selfSize: 48,
    edges: [{ type: "context", name: "node", to: 4 }],
  },
  { type: "native", name: "Detached HTMLDivElement", selfSize: 120, detachedness: 2 },
  { name: "Object", selfSize: 16 },
];

describe("parseHeapSnapshot", () => {
  it("decodes node fields from the flat table", () => {
    const graph = parseHeapSnapshot(buildHeapSnapshot(LEAKY_PAGE));

    expect(graph.nodeCount).toBe(6);
    expect(graph.node(1)).toMatchObject({
      ordinal: 1,
      type: "object",
      name: "Window",
      selfSize: 64,
      edgeCount: 2,
      detachedness: 0,
    });
    expect(graph.node(4)).toMatchObject({
      type: "native",
      name: "Detached HTMLDivElement",
      detachedness: 2,
    });
  });

  it("accepts the raw JSON text CDP streams", () => {
    const graph = parseHeapSnapshot(JSON.stringify(buildHeapSnapshot(LEAKY_PAGE)));

    expect(graph.nodeName(4)).toBe("Detached HTMLDivElement");
  });

  it("resolves each node's edge slice from the preceding edge counts", () => {
    const graph = parseHeapSnapshot(buildHeapSnapshot(LEAKY_PAGE));

    // Node 1 owns edges 1 and 2; getting the running offset wrong is the
    // classic way a reader reports node 1's edges as node 0's.
    expect(graph.edgesFrom(1)).toEqual([
      { type: "internal", name: "listeners", to: 2, from: 1 },
      { type: "property", name: "unrelated", to: 5, from: 1 },
    ]);
    expect(graph.edgesFrom(5)).toEqual([]);
  });

  it("reads an element edge's name as a number, not a string-table index", () => {
    const graph = parseHeapSnapshot(buildHeapSnapshot(LEAKY_PAGE));

    // "0" here is the array index. Looking it up in the string table would
    // return "(GC roots)" — a plausible-looking, entirely wrong name.
    expect(graph.edgesFrom(2)).toEqual([{ type: "element", name: "0", to: 3, from: 2 }]);
  });

  it("finds every edge pointing at a node", () => {
    const graph = parseHeapSnapshot(
      buildHeapSnapshot([
        {
          type: "synthetic",
          name: "(GC roots)",
          edges: [
            { name: "a", to: 1 },
            { name: "b", to: 2 },
          ],
        },
        { name: "A", edges: [{ name: "shared", to: 3 }] },
        { name: "B", edges: [{ name: "shared", to: 3 }] },
        { name: "Shared" },
      ]),
    );

    expect(graph.retainersOf(3)).toEqual([
      { type: "property", name: "shared", to: 3, from: 1 },
      { type: "property", name: "shared", to: 3, from: 2 },
    ]);
    expect(graph.retainersOf(0)).toEqual([]);
  });

  it("rejects a snapshot missing a field it has to address", () => {
    const snapshot = buildHeapSnapshot(LEAKY_PAGE);
    const broken = {
      ...snapshot,
      snapshot: {
        ...snapshot.snapshot,
        meta: { ...snapshot.snapshot.meta, node_fields: ["type", "id"] },
      },
    };

    expect(() => parseHeapSnapshot(broken)).toThrow(/no node field "name"/);
  });

  it("reads a pre-8.x snapshot that has no detachedness column", () => {
    const snapshot = buildHeapSnapshot([{ name: "Detached HTMLDivElement", type: "native" }]);
    const fields = snapshot.snapshot.meta.node_fields.filter((f) => f !== "detachedness");
    const legacy = {
      ...snapshot,
      snapshot: {
        ...snapshot.snapshot,
        meta: { ...snapshot.snapshot.meta, node_fields: fields },
      },
      // Drop the trailing column from the one node's row.
      nodes: snapshot.nodes.slice(0, fields.length),
    };

    const graph = parseHeapSnapshot(legacy);
    expect(graph.node(0).detachedness).toBe(0);
    // The name prefix still answers the question. That is the point of keeping
    // both signals rather than trusting the column alone.
    expect(findDetachedNodes(graph)).toHaveLength(1);
  });
});

describe("findDetachedNodes", () => {
  it("takes the union of the detachedness flag and the name prefix", () => {
    const graph = parseHeapSnapshot(
      buildHeapSnapshot([
        { type: "synthetic", name: "(GC roots)" },
        { type: "native", name: "Detached HTMLDivElement", detachedness: 2, selfSize: 100 },
        { type: "native", name: "Detached InternalNode", selfSize: 40 },
        { type: "native", name: "HTMLSpanElement", detachedness: 2, selfSize: 60 },
        { type: "native", name: "HTMLSpanElement", detachedness: 1, selfSize: 60 },
      ]),
    );

    expect(findDetachedNodes(graph).map((node) => [node.name, node.evidence])).toEqual([
      ["Detached HTMLDivElement", "both"],
      ["Detached InternalNode", "name"],
      ["HTMLSpanElement", "detachedness"],
    ]);
  });

  it("groups a detached population by class, biggest first", () => {
    const graph = parseHeapSnapshot(
      buildHeapSnapshot([
        { type: "synthetic", name: "(GC roots)" },
        { type: "native", name: "Detached HTMLDivElement", selfSize: 100 },
        { type: "native", name: "Detached HTMLDivElement", selfSize: 100 },
        { type: "native", name: "Detached Text", selfSize: 30 },
      ]),
    );

    expect(summarizeDetached(findDetachedNodes(graph))).toEqual({
      count: 3,
      selfSize: 230,
      bySpecies: [
        { species: "HTMLDivElement", count: 2, selfSize: 200 },
        { species: "Text", count: 1, selfSize: 30 },
      ],
    });
  });

  it("counts elements by tag, not by the attributes Chrome puts in the name", () => {
    // Real names, shortened. With Tailwind these run to hundreds of
    // characters, and grouping on them gives one bucket per element — the
    // exact opposite of what a histogram is for.
    const graph = parseHeapSnapshot(
      buildHeapSnapshot([
        { type: "synthetic", name: "(GC roots)" },
        { type: "native", name: 'Detached <div class="flex min-h-screen">', selfSize: 120 },
        { type: "native", name: 'Detached <div class="p-8 py-16">', selfSize: 120 },
        { type: "native", name: "Detached <span>", selfSize: 60 },
        { type: "native", name: "Detached InternalNode", selfSize: 40 },
      ]),
    );

    const summary = summarizeDetached(findDetachedNodes(graph));
    expect(summary.bySpecies).toEqual([
      { species: "<div>", count: 2, selfSize: 240 },
      { species: "<span>", count: 1, selfSize: 60 },
      { species: "InternalNode", count: 1, selfSize: 40 },
    ]);
  });

  it("keeps the full name on the node so a report can still say which div", () => {
    const graph = parseHeapSnapshot(
      buildHeapSnapshot([
        { type: "synthetic", name: "(GC roots)" },
        { type: "native", name: 'Detached <div class="flex min-h-screen">' },
      ]),
    );

    expect(findDetachedNodes(graph)[0]).toMatchObject({
      name: 'Detached <div class="flex min-h-screen">',
      species: "<div>",
    });
  });

  it("summarizes an empty population without inventing a row", () => {
    expect(summarizeDetached([])).toEqual({ count: 0, selfSize: 0, bySpecies: [] });
  });
});

describe("shortestRetainerPath", () => {
  it("reports the path root-first, naming the edge taken at each hop", () => {
    const graph = parseHeapSnapshot(buildHeapSnapshot(LEAKY_PAGE));

    expect(shortestRetainerPath(graph, 4)).toEqual([
      { name: "(GC roots)", type: "synthetic", via: "shortcut window" },
      { name: "Window", type: "object", via: "internal listeners" },
      { name: "EventListener", type: "array", via: "element 0" },
      { name: "onResize", type: "closure", via: "context node" },
    ]);
  });

  it("takes the shortest path when a node has several retainers", () => {
    const graph = parseHeapSnapshot(
      buildHeapSnapshot([
        {
          type: "synthetic",
          name: "(GC roots)",
          edges: [
            { name: "long", to: 1 },
            { name: "short", to: 3 },
          ],
        },
        { name: "Hop1", edges: [{ name: "next", to: 2 }] },
        { name: "Hop2", edges: [{ name: "target", to: 4 }] },
        { name: "Direct", edges: [{ name: "target", to: 4 }] },
        { type: "native", name: "Detached HTMLDivElement", detachedness: 2 },
      ]),
    );

    expect(shortestRetainerPath(graph, 4)?.map((step) => step.name)).toEqual([
      "(GC roots)",
      "Direct",
    ]);
  });

  it("never explains a leak with a weak reference", () => {
    const graph = parseHeapSnapshot(
      buildHeapSnapshot([
        {
          type: "synthetic",
          name: "(GC roots)",
          edges: [
            { type: "weak", name: "weakSet", to: 1 },
            { name: "realOwner", to: 2 },
          ],
        },
        { name: "WeakRefHolder", edges: [{ type: "weak", name: "target", to: 3 }] },
        { name: "Cache", edges: [{ name: "entry", to: 3 }] },
        { type: "native", name: "Detached HTMLDivElement", detachedness: 2 },
      ]),
    );

    // The weak path is one hop shorter. Following it would name the WeakRef as
    // the culprit, which is exactly backwards: a weak reference is the one
    // thing that is provably not keeping the node alive.
    expect(shortestRetainerPath(graph, 3)?.map((step) => step.name)).toEqual([
      "(GC roots)",
      "Cache",
    ]);
  });

  it("returns null rather than a partial path when nothing retains the node", () => {
    const graph = parseHeapSnapshot(
      buildHeapSnapshot([
        { type: "synthetic", name: "(GC roots)" },
        { type: "native", name: "Detached HTMLDivElement", detachedness: 2 },
      ]),
    );

    expect(shortestRetainerPath(graph, 1)).toBeNull();
  });

  it("gives up at the depth limit instead of walking an arbitrarily long chain", () => {
    const chain: FixtureNode[] = [
      { type: "synthetic", name: "(GC roots)", edges: [{ name: "head", to: 1 }] },
    ];
    for (let index = 1; index <= 10; index += 1) {
      chain.push({ name: `Hop${String(index)}`, edges: [{ name: "next", to: index + 1 }] });
    }
    chain.push({ type: "native", name: "Detached HTMLDivElement", detachedness: 2 });
    const graph = parseHeapSnapshot(buildHeapSnapshot(chain));

    expect(shortestRetainerPath(graph, 11, { maxDepth: 4 })).toBeNull();
    expect(shortestRetainerPath(graph, 11, { maxDepth: 20 })).toHaveLength(11);
  });
});
