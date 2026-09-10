import type { RawHeapSnapshot } from "./heapSnapshot.ts";

/**
 * Builds a valid V8 heap snapshot from a readable description.
 *
 * The parser's whole job is index arithmetic over three flat arrays, and a
 * test that hand-writes those arrays is a test of whether the *test author*
 * did the arithmetic right. This builder is the arithmetic written once, in
 * the encoding direction, so a test can say "node 2 has a property edge to
 * node 5" and the assertions are about the reader.
 *
 * It deliberately reproduces the two encodings that are easy to get wrong and
 * that the parser has to handle:
 *
 * - `to_node` is a *flat offset* (`ordinal × node_fields.length`), not an
 *   ordinal;
 * - an edge's `name_or_index` is a string-table index for most edge types and
 *   a bare number for `element` and `hidden`.
 */

export const NODE_TYPES = [
  "hidden",
  "array",
  "string",
  "object",
  "code",
  "closure",
  "regexp",
  "number",
  "native",
  "synthetic",
  "concatenated string",
  "sliced string",
  "symbol",
  "bigint",
  "object shape",
] as const;

export const EDGE_TYPES = [
  "context",
  "element",
  "property",
  "internal",
  "hidden",
  "shortcut",
  "weak",
] as const;

export interface FixtureEdge {
  /** Defaults to `property`. */
  readonly type?: (typeof EDGE_TYPES)[number];
  /** Property name, or the numeric index for `element` / `hidden` edges. */
  readonly name: string;
  /** Ordinal of the target node. */
  readonly to: number;
}

export interface FixtureNode {
  /** Defaults to `object`. */
  readonly type?: (typeof NODE_TYPES)[number];
  readonly name: string;
  readonly selfSize?: number;
  /** 0 unknown, 1 attached, 2 detached. Defaults to 0. */
  readonly detachedness?: number;
  readonly edges?: readonly FixtureEdge[];
}

/**
 * Encodes `nodes` as a snapshot.
 *
 * Node ordinals are array positions, so ordinal 0 is the first entry and is
 * treated by the parser as the GC root — give it a `synthetic` `(GC roots)`
 * node, as a real snapshot does, whenever a test cares about retainer paths.
 */
export function buildHeapSnapshot(nodes: readonly FixtureNode[]): RawHeapSnapshot {
  const nodeFields = [
    "type",
    "name",
    "id",
    "self_size",
    "edge_count",
    "trace_node_id",
    "detachedness",
  ];
  const edgeFields = ["type", "name_or_index", "to_node"];

  const strings: string[] = [];
  const stringIndex = (value: string): number => {
    const existing = strings.indexOf(value);
    if (existing !== -1) return existing;
    strings.push(value);
    return strings.length - 1;
  };

  const nodeData: number[] = [];
  const edgeData: number[] = [];

  nodes.forEach((node, ordinal) => {
    const edges = node.edges ?? [];
    nodeData.push(
      NODE_TYPES.indexOf(node.type ?? "object"),
      stringIndex(node.name),
      // Ids are odd for objects in a real snapshot; the exact scheme does not
      // matter here, only that they are stable and distinct.
      ordinal * 2 + 1,
      node.selfSize ?? 0,
      edges.length,
      0,
      node.detachedness ?? 0,
    );
    for (const edge of edges) {
      const type = edge.type ?? "property";
      edgeData.push(
        EDGE_TYPES.indexOf(type),
        type === "element" || type === "hidden" ? Number(edge.name) : stringIndex(edge.name),
        edge.to * nodeFields.length,
      );
    }
  });

  return {
    snapshot: {
      meta: {
        node_fields: nodeFields,
        node_types: [[...NODE_TYPES], "string", "number", "number", "number", "number", "number"],
        edge_fields: edgeFields,
        edge_types: [[...EDGE_TYPES], "string_or_number", "node"],
      },
      node_count: nodes.length,
      edge_count: edgeData.length / edgeFields.length,
    },
    nodes: nodeData,
    edges: edgeData,
    strings,
  };
}
