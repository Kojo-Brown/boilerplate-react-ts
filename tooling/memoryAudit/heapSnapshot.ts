/**
 * A reader for V8 heap snapshots, and the two questions a leak hunt asks of one.
 *
 * DevTools' "Detached elements" panel and its retainer tree are the tools a
 * human uses; this is the same information in a form a CI job can fail on. The
 * snapshot itself is what `HeapProfiler.takeHeapSnapshot` streams over CDP —
 * see `captureSnapshot.ts` — and its shape is not a convenience format:
 *
 *   nodes:   one flat number array, `node_fields.length` numbers per node
 *   edges:   one flat number array, `edge_fields.length` numbers per edge,
 *            with node *i*'s edges lying immediately after node *i-1*'s
 *   strings: every name in the snapshot, deduplicated; nodes and most edges
 *            carry an index into it rather than the text
 *
 * Everything below is index arithmetic over those three arrays, which is
 * deliberate. A real snapshot of this application is 1–3 million nodes; turning
 * each into an object costs hundreds of megabytes and several seconds before
 * any question has been asked. Nodes are materialised only where a caller asks
 * for one by ordinal.
 *
 * ## What "detached" means here
 *
 * Two independent signals, and both are needed:
 *
 * 1. **`detachedness`**, a per-node field V8 added in 8.x: 0 unknown, 1
 *    attached, 2 detached. It is authoritative for DOM nodes the collector
 *    reached through the DOM's own tracing, and it is the signal that survives
 *    a snapshot taken with names elided.
 * 2. **The `Detached ` name prefix**, which is what the DevTools UI shows
 *    (`Detached HTMLDivElement`, `Detached <div>`). It also covers nodes V8
 *    marks 0/unknown but names as detached, which in practice is most of the
 *    text nodes hanging off a detached subtree.
 *
 * Taking the union means the count is comparable with what a human sees in
 * DevTools rather than being a lower bound nobody can reconcile with it.
 */

/** The field names every snapshot declares in `snapshot.meta`. */
export interface HeapSnapshotMeta {
  readonly node_fields: readonly string[];
  readonly node_types: readonly (readonly string[] | string)[];
  readonly edge_fields: readonly string[];
  readonly edge_types: readonly (readonly string[] | string)[];
}

/** The JSON `HeapProfiler.takeHeapSnapshot` produces, as far as this reader cares. */
export interface RawHeapSnapshot {
  readonly snapshot: {
    readonly meta: HeapSnapshotMeta;
    readonly node_count?: number;
    readonly edge_count?: number;
  };
  readonly nodes: readonly number[];
  readonly edges: readonly number[];
  readonly strings: readonly string[];
}

/** One node, materialised on request. */
export interface HeapNode {
  /** Position in the node table. The stable handle for everything else here. */
  readonly ordinal: number;
  /** `object`, `native`, `closure`, `synthetic`, … from `node_types[0]`. */
  readonly type: string;
  readonly name: string;
  /** V8's own object id. Stable across snapshots of the same page. */
  readonly id: number;
  readonly selfSize: number;
  readonly edgeCount: number;
  /** 0 unknown, 1 attached, 2 detached. */
  readonly detachedness: number;
}

/** One edge, materialised on request. */
export interface HeapEdge {
  /** `property`, `element`, `internal`, `weak`, … from `edge_types[0]`. */
  readonly type: string;
  /** The property name, or the index as a string for element edges. */
  readonly name: string;
  /** Ordinal of the node this edge points at. */
  readonly to: number;
  /** Ordinal of the node this edge leaves from. */
  readonly from: number;
}

export interface HeapGraph {
  readonly nodeCount: number;
  readonly edgeCount: number;
  node(ordinal: number): HeapNode;
  /** Just the name, without materialising the node. Hot path for scans. */
  nodeName(ordinal: number): string;
  edgesFrom(ordinal: number): readonly HeapEdge[];
  /** Every edge pointing *at* `ordinal`. Builds the reverse index on first use. */
  retainersOf(ordinal: number): readonly HeapEdge[];
}

/** Prefix V8 gives a DOM wrapper it knows is out of the document. */
export const DETACHED_NAME_PREFIX = "Detached ";

/** `detachedness` value meaning "definitely not in the document". */
export const DETACHED_STATE = 2;

function requireIndex(fields: readonly string[], field: string, kind: string): number {
  const index = fields.indexOf(field);
  if (index === -1) {
    throw new Error(`Heap snapshot declares no ${kind} field "${field}".`);
  }
  return index;
}

function typeNames(
  types: readonly (readonly string[] | string)[],
  index: number,
): readonly string[] {
  const entry = types[index];
  // `node_types` mixes shapes: the type column is an array of names, every
  // other column is a single string naming a primitive ("string", "number").
  if (entry === undefined || typeof entry === "string") {
    throw new Error(`Heap snapshot field ${String(index)} is not an enumerated type.`);
  }
  return entry;
}

/**
 * Indexes a snapshot for querying.
 *
 * Accepts the parsed object or the raw JSON text. The text form exists because
 * that is what CDP streams, and `JSON.parse` on a 400MB string is the one
 * unavoidable cost in the whole pipeline — no caller should be tempted to pay
 * it twice.
 */
export function parseHeapSnapshot(source: string | RawHeapSnapshot): HeapGraph {
  const raw = typeof source === "string" ? (JSON.parse(source) as RawHeapSnapshot) : source;
  const { meta } = raw.snapshot;

  const nodeFields = meta.node_fields;
  const edgeFields = meta.edge_fields;
  const nodeFieldCount = nodeFields.length;
  const edgeFieldCount = edgeFields.length;

  const nodeTypeOffset = requireIndex(nodeFields, "type", "node");
  const nodeNameOffset = requireIndex(nodeFields, "name", "node");
  const nodeIdOffset = requireIndex(nodeFields, "id", "node");
  const nodeSelfSizeOffset = requireIndex(nodeFields, "self_size", "node");
  const nodeEdgeCountOffset = requireIndex(nodeFields, "edge_count", "node");
  // Snapshots from V8 before 8.x have no `detachedness` column at all. Absent
  // is not an error: the name prefix still answers the question, just less
  // completely, and refusing to read the file would be the worse failure.
  const nodeDetachednessOffset = nodeFields.indexOf("detachedness");

  const edgeTypeOffset = requireIndex(edgeFields, "type", "edge");
  const edgeNameOffset = requireIndex(edgeFields, "name_or_index", "edge");
  const edgeToNodeOffset = requireIndex(edgeFields, "to_node", "edge");

  const nodeTypes = typeNames(meta.node_types, nodeTypeOffset);
  const edgeTypes = typeNames(meta.edge_types, edgeTypeOffset);

  const { nodes, edges, strings } = raw;
  const nodeCount = raw.snapshot.node_count ?? nodes.length / nodeFieldCount;
  const edgeCount = raw.snapshot.edge_count ?? edges.length / edgeFieldCount;

  const field = (ordinal: number, offset: number): number =>
    nodes[ordinal * nodeFieldCount + offset] ?? 0;

  const string = (index: number): string => strings[index] ?? "";

  /**
   * Where node *i*'s edges start, as an edge ordinal.
   *
   * Built eagerly, because it is the only way to address a node's edges at all
   * — the snapshot stores no offset, only each node's count, so the start of
   * node *i* is the sum of every count before it. One pass, one typed array.
   */
  const firstEdge = new Uint32Array(nodeCount + 1);
  for (let ordinal = 0; ordinal < nodeCount; ordinal += 1) {
    firstEdge[ordinal + 1] = (firstEdge[ordinal] ?? 0) + field(ordinal, nodeEdgeCountOffset);
  }

  const edgeAt = (edgeOrdinal: number, from: number): HeapEdge => {
    const base = edgeOrdinal * edgeFieldCount;
    const typeIndex = edges[base + edgeTypeOffset] ?? 0;
    const type = edgeTypes[typeIndex] ?? String(typeIndex);
    const nameOrIndex = edges[base + edgeNameOffset] ?? 0;
    // `element` and `hidden` edges carry a numeric index in the same column
    // every other edge type uses for a string index. Reading one through the
    // string table yields an unrelated name — the classic way a retainer path
    // comes out looking plausible and being wrong.
    const name =
      type === "element" || type === "hidden" ? String(nameOrIndex) : string(nameOrIndex);
    // `to_node` is a byte-style offset into the flat node array, not an ordinal.
    const to = (edges[base + edgeToNodeOffset] ?? 0) / nodeFieldCount;
    return { type, name, to, from };
  };

  let reverse: Uint32Array | null = null;
  let reverseStart: Uint32Array | null = null;

  /**
   * Retainer index: for each node, the edge ordinals pointing at it.
   *
   * A CSR-style pair of typed arrays rather than a `Map<number, number[]>`,
   * for the same reason nodes are not materialised: on a real snapshot the map
   * is several million small arrays. Built on first use, because a caller that
   * only counts detached nodes never needs it.
   */
  const buildReverseIndex = (): { index: Uint32Array; start: Uint32Array } => {
    const counts = new Uint32Array(nodeCount + 1);
    for (let edgeOrdinal = 0; edgeOrdinal < edgeCount; edgeOrdinal += 1) {
      const to = (edges[edgeOrdinal * edgeFieldCount + edgeToNodeOffset] ?? 0) / nodeFieldCount;
      if (to >= 0 && to < nodeCount) counts[to + 1] = (counts[to + 1] ?? 0) + 1;
    }
    const start = new Uint32Array(nodeCount + 1);
    for (let ordinal = 0; ordinal < nodeCount; ordinal += 1) {
      start[ordinal + 1] = (start[ordinal] ?? 0) + (counts[ordinal + 1] ?? 0);
    }
    const cursor = Uint32Array.from(start);
    const index = new Uint32Array(edgeCount);
    for (let ordinal = 0; ordinal < nodeCount; ordinal += 1) {
      const end = firstEdge[ordinal + 1] ?? 0;
      for (let edgeOrdinal = firstEdge[ordinal] ?? 0; edgeOrdinal < end; edgeOrdinal += 1) {
        const to = (edges[edgeOrdinal * edgeFieldCount + edgeToNodeOffset] ?? 0) / nodeFieldCount;
        if (to < 0 || to >= nodeCount) continue;
        const slot = cursor[to] ?? 0;
        index[slot] = edgeOrdinal;
        cursor[to] = slot + 1;
      }
    }
    return { index, start };
  };

  /** Which node an edge ordinal belongs to. Binary search over `firstEdge`. */
  const ownerOfEdge = (edgeOrdinal: number): number => {
    let low = 0;
    let high = nodeCount - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((firstEdge[mid] ?? 0) <= edgeOrdinal) low = mid;
      else high = mid - 1;
    }
    return low;
  };

  return {
    nodeCount,
    edgeCount,

    nodeName(ordinal) {
      return string(field(ordinal, nodeNameOffset));
    },

    node(ordinal) {
      const typeIndex = field(ordinal, nodeTypeOffset);
      return {
        ordinal,
        type: nodeTypes[typeIndex] ?? String(typeIndex),
        name: string(field(ordinal, nodeNameOffset)),
        id: field(ordinal, nodeIdOffset),
        selfSize: field(ordinal, nodeSelfSizeOffset),
        edgeCount: field(ordinal, nodeEdgeCountOffset),
        detachedness: nodeDetachednessOffset === -1 ? 0 : field(ordinal, nodeDetachednessOffset),
      };
    },

    edgesFrom(ordinal) {
      const start = firstEdge[ordinal] ?? 0;
      const end = firstEdge[ordinal + 1] ?? start;
      const result: HeapEdge[] = [];
      for (let edgeOrdinal = start; edgeOrdinal < end; edgeOrdinal += 1) {
        result.push(edgeAt(edgeOrdinal, ordinal));
      }
      return result;
    },

    retainersOf(ordinal) {
      if (reverse === null || reverseStart === null) {
        const built = buildReverseIndex();
        reverse = built.index;
        reverseStart = built.start;
      }
      const start = reverseStart[ordinal] ?? 0;
      const end = reverseStart[ordinal + 1] ?? start;
      const result: HeapEdge[] = [];
      for (let slot = start; slot < end; slot += 1) {
        const edgeOrdinal = reverse[slot] ?? 0;
        result.push(edgeAt(edgeOrdinal, ownerOfEdge(edgeOrdinal)));
      }
      return result;
    },
  };
}

/** A detached DOM wrapper, with enough context to be reported. */
export interface DetachedNode {
  readonly ordinal: number;
  readonly id: number;
  readonly name: string;
  /** The class the name describes: `HTMLDivElement`, `<div>`, `Text`. */
  readonly species: string;
  readonly selfSize: number;
  /** Which of the two signals found it. Both, for a node V8 agrees about. */
  readonly evidence: "detachedness" | "name" | "both";
}

/**
 * The class a detached node should be counted under.
 *
 * Chrome names an element node with its opening tag *including its
 * attributes* — `Detached <div class="flex min-h-screen flex-col …">`. With
 * Tailwind that is a two-hundred-character name, and two divs that differ by
 * one utility class count as two different things, which is precisely wrong
 * for the question being asked: a leak is fifty of the *same* kind of node.
 * Trimming to the tag turns an unreadable histogram of one-element buckets
 * into `<div> × 47`. The untrimmed name is kept on the node itself, so a
 * report can still show which div.
 */
function speciesOf(name: string): string {
  const bare = name.startsWith(DETACHED_NAME_PREFIX)
    ? name.slice(DETACHED_NAME_PREFIX.length)
    : name;
  if (!bare.startsWith("<")) return bare;
  const cut = bare.search(/[\s>]/);
  return cut === -1 ? bare : `${bare.slice(0, cut)}>`;
}

/**
 * Every node the snapshot says is a detached DOM node.
 *
 * `InternalNode` is kept rather than filtered. It is the shadow-DOM and
 * pseudo-element bookkeeping V8 cannot name, and it is the bulk of what a
 * detached subtree actually costs — dropping it makes the number smaller and
 * the report less true.
 */
export function findDetachedNodes(graph: HeapGraph): DetachedNode[] {
  const found: DetachedNode[] = [];
  for (let ordinal = 0; ordinal < graph.nodeCount; ordinal += 1) {
    const name = graph.nodeName(ordinal);
    const namedDetached = name.startsWith(DETACHED_NAME_PREFIX);
    const node = graph.node(ordinal);
    const stateDetached = node.detachedness === DETACHED_STATE;
    if (!namedDetached && !stateDetached) continue;
    found.push({
      ordinal,
      id: node.id,
      name,
      species: speciesOf(name),
      selfSize: node.selfSize,
      evidence: namedDetached && stateDetached ? "both" : namedDetached ? "name" : "detachedness",
    });
  }
  return found;
}

export interface DetachedSpecies {
  readonly species: string;
  readonly count: number;
  readonly selfSize: number;
}

export interface DetachedSummary {
  readonly count: number;
  readonly selfSize: number;
  /** Per class, biggest population first. What a report leads with. */
  readonly bySpecies: readonly DetachedSpecies[];
}

export function summarizeDetached(nodes: readonly DetachedNode[]): DetachedSummary {
  const buckets = new Map<string, { count: number; selfSize: number }>();
  let selfSize = 0;
  for (const node of nodes) {
    selfSize += node.selfSize;
    const bucket = buckets.get(node.species) ?? { count: 0, selfSize: 0 };
    bucket.count += 1;
    bucket.selfSize += node.selfSize;
    buckets.set(node.species, bucket);
  }
  const bySpecies = [...buckets.entries()]
    .map(([species, bucket]) => ({ species, count: bucket.count, selfSize: bucket.selfSize }))
    .sort((a, b) => b.count - a.count || a.species.localeCompare(b.species));
  return { count: nodes.length, selfSize, bySpecies };
}

/** One hop of a retaining path, read root-first. */
export interface RetainerStep {
  /** The retaining node's name. */
  readonly name: string;
  readonly type: string;
  /** How it reaches the next step: the edge's type and name. */
  readonly via: string;
}

export interface RetainerPathOptions {
  /** Give up after this many nodes. Guards against a pathological graph. */
  readonly maxVisited?: number;
  /** Give up below this many hops from the target. */
  readonly maxDepth?: number;
}

/**
 * The shortest path from a GC root to `ordinal`, or `null` if there is none.
 *
 * This is the half of the report that makes a leak fixable. "40 detached
 * divs" is a symptom; "40 detached divs, each reached through
 * `(GC roots) → Window → listener → context → node`" names the line of code.
 *
 * Searched backwards from the target rather than forwards from the root,
 * because the fan-out is the other way round: a root reaches essentially every
 * node in the heap, while the retainer set of one detached element is small.
 *
 * `weak` edges are skipped. A weak reference is, by construction, not what is
 * keeping something alive, and following one produces a path that explains
 * nothing — it is the single most common way a hand-rolled retainer search
 * reports the wrong culprit.
 */
export function shortestRetainerPath(
  graph: HeapGraph,
  ordinal: number,
  options: RetainerPathOptions = {},
): RetainerStep[] | null {
  const { maxVisited = 200_000, maxDepth = 24 } = options;
  /**
   * Discovered node → the edge that discovered it, which points *away* from
   * the root. Keyed by the retainer rather than the retained, so the finished
   * chain can be walked root-first by following `edge.to`; keying it the other
   * way round loses the branch as soon as a node has two retainers, and the
   * second one silently overwrites the path through the first.
   */
  const discoveredBy = new Map<number, HeapEdge>();
  const seen = new Set<number>([ordinal]);
  let frontier = [ordinal];
  let depth = 0;

  while (frontier.length > 0 && depth < maxDepth && seen.size < maxVisited) {
    const next: number[] = [];
    for (const current of frontier) {
      for (const edge of graph.retainersOf(current)) {
        if (edge.type === "weak") continue;
        if (seen.has(edge.from)) continue;
        seen.add(edge.from);
        discoveredBy.set(edge.from, edge);

        // Ordinal 0 is the snapshot's root. Reaching it is the only stopping
        // condition that means "this is genuinely reachable", as opposed to
        // "the search ran out of budget".
        if (edge.from === 0) return buildPath(graph, discoveredBy, 0);

        next.push(edge.from);
        if (seen.size >= maxVisited) break;
      }
      if (seen.size >= maxVisited) break;
    }
    frontier = next;
    depth += 1;
  }

  return null;
}

function buildPath(
  graph: HeapGraph,
  discoveredBy: ReadonlyMap<number, HeapEdge>,
  root: number,
): RetainerStep[] {
  const steps: RetainerStep[] = [];
  let current = root;
  for (;;) {
    const edge = discoveredBy.get(current);
    if (edge === undefined) break;
    const node = graph.node(edge.from);
    steps.push({
      // A real snapshot's node 0 is nameless — the familiar "(GC roots)" is
      // one of its children, not the root itself — so it gets a label rather
      // than being rendered as a bare "synthetic".
      name: node.name !== "" ? node.name : edge.from === 0 ? "(root)" : node.type,
      type: node.type,
      via: edge.name === "" ? edge.type : `${edge.type} ${edge.name}`,
    });
    current = edge.to;
  }
  return steps;
}
