import type { LeakFinding, LeakVerdict } from "./leakVerdict.ts";
import type { DetachedSummary, RetainerStep } from "./heapSnapshot.ts";
import type { ListenerDelta } from "./listenerProbe.ts";

/**
 * Rendering a leak audit so the failure message is the diagnosis.
 *
 * A failing memory gate is the one CI failure engineers are most likely to
 * dismiss, because the usual message — "expected 41 to be less than 20" —
 * carries no way to tell a real leak from a flaky measurement. Everything here
 * exists to make the assertion message contain what a person would otherwise
 * have to reproduce locally with DevTools: which metric moved, by how much per
 * iteration, what class of node accumulated, and who is holding it.
 */

function pad(value: string, width: number): string {
  return value.padEnd(width, " ");
}

function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  return `${(bytes / 1000).toFixed(1)} kB`;
}

function formatPerIteration(finding: LeakFinding): string {
  if (finding.perIteration === null) return `limit ${String(finding.allowed)}`;
  return `${finding.perIteration.toFixed(2)}/iter (max ${String(finding.allowed)})`;
}

/** The verdict table: one row per metric, passing rows included. */
export function formatVerdict(verdict: LeakVerdict): string {
  const rows = verdict.findings.map((finding) => ({
    label: finding.label,
    before: String(finding.before),
    after: String(finding.after),
    growth: finding.growth > 0 ? `+${String(finding.growth)}` : String(finding.growth),
    rate: formatPerIteration(finding),
    mark: finding.status === "ok" ? "  " : "! ",
  }));
  const width = (key: "label" | "before" | "after" | "growth"): number =>
    Math.max(key.length, ...rows.map((row) => row[key].length));

  const lines = [
    `Memory audit — ${String(verdict.iterations)} iterations between samples`,
    "",
    `  ${pad("label", width("label"))}  ${pad("before", width("before"))}  ${pad("after", width("after"))}  ${pad("growth", width("growth"))}`,
  ];
  for (const row of rows) {
    lines.push(
      `${row.mark}${pad(row.label, width("label"))}  ${pad(row.before, width("before"))}  ${pad(row.after, width("after"))}  ${pad(row.growth, width("growth"))}  ${row.rate}`,
    );
  }
  lines.push(
    "",
    `  detached shallow size: ${formatBytes(verdict.detachedBytes.before)} → ${formatBytes(verdict.detachedBytes.after)}`,
  );
  return lines.join("\n");
}

/** The detached population, biggest class first. Where a leak names itself. */
export function formatDetachedSummary(summary: DetachedSummary, limit = 8): string {
  if (summary.count === 0) return "No detached DOM nodes.";
  const lines = [
    `${String(summary.count)} detached DOM nodes, ${formatBytes(summary.selfSize)} shallow:`,
  ];
  for (const species of summary.bySpecies.slice(0, limit)) {
    lines.push(
      `  ${String(species.count).padStart(6, " ")}  ${species.species}  (${formatBytes(species.selfSize)})`,
    );
  }
  const remaining = summary.bySpecies.length - limit;
  if (remaining > 0) lines.push(`  … and ${String(remaining)} more classes`);
  return lines.join("\n");
}

/** Listener registrations that moved between the two samples. */
export function formatListenerDeltas(deltas: readonly ListenerDelta[], limit = 8): string {
  if (deltas.length === 0) return "No listener registrations changed.";
  const lines = ["Listener registrations that moved:"];
  for (const delta of deltas.slice(0, limit)) {
    const sign = delta.growth > 0 ? "+" : "";
    const note = delta.detached ? "  (target is detached)" : "";
    lines.push(
      `  ${sign}${String(delta.growth).padStart(4, " ")}  ${delta.target} → ${delta.type}  (${String(delta.before)} → ${String(delta.after)})${note}`,
    );
  }
  const remaining = deltas.length - limit;
  if (remaining > 0) lines.push(`  … and ${String(remaining)} more`);
  return lines.join("\n");
}

/**
 * A retainer path, root-first, one hop per line.
 *
 * Indented progressively because the shape is what carries the meaning: the
 * hop where an application name appears between two engine internals is the
 * line to go and read.
 */
export function formatRetainerPath(path: readonly RetainerStep[] | null): string {
  if (path === null) return "  (no retaining path found within the search budget)";
  if (path.length === 0) return "  (node is a GC root)";
  return path
    .map((step, index) => `${" ".repeat(index + 2)}${step.name} [${step.type}] --${step.via}-->`)
    .join("\n");
}
