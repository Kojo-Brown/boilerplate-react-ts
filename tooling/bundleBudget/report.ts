import type { Finding, Verdict } from "./evaluate.ts";

/**
 * Rendering the verdict.
 *
 * Two audiences. The terminal output is for whoever is about to fix it, so it
 * leads with what is wrong and by how much. The Markdown is for
 * `$GITHUB_STEP_SUMMARY`, where the whole table is worth having even when
 * nothing is red — a pull request that moves `initial.js` from 140kB to 178kB
 * against a 185kB ceiling passes the gate and is still the most interesting
 * thing in the build.
 */

/** kB, decimal — the unit Vite's own build output prints, so the two agree. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  return `${(bytes / 1000).toFixed(2)} kB`;
}

function formatDelta(finding: Finding): string {
  if (finding.actual === null) return "—";
  if (finding.budget === null) return "no budget";
  const delta = finding.actual - finding.budget;
  const percent = finding.budget === 0 ? 0 : (Math.abs(delta) / finding.budget) * 100;
  const sign = delta < 0 ? "-" : "+";
  return `${sign}${formatBytes(Math.abs(delta))} (${sign}${percent.toFixed(1)}%)`;
}

const EXPLANATIONS: Record<Finding["status"], string> = {
  ok: "",
  over: "over budget",
  "missing-budget": "no budget entry — add one to bundle-budget.json",
  "stale-budget": "budget entry matches nothing in this build — remove it",
};

function pad(value: string, width: number): string {
  return value.padEnd(width, " ");
}

/** Human-readable table for a terminal. */
export function formatText(verdict: Verdict): string {
  const rows = verdict.findings.map((f) => ({
    id: f.id,
    size: f.actual === null ? "—" : formatBytes(f.actual),
    budget: f.budget === null ? "—" : formatBytes(f.budget),
    delta: formatDelta(f),
    note: f.status === "ok" ? f.detail : `${EXPLANATIONS[f.status]} · ${f.detail}`,
    mark: f.status === "ok" ? "  " : "! ",
  }));
  const width = (key: "id" | "size" | "budget" | "delta"): number =>
    Math.max(key.length, ...rows.map((r) => r[key].length));

  const lines = [`Bundle budget — sizes are ${verdict.compression}`, ""];
  lines.push(
    `  ${pad("id", width("id"))}  ${pad("size", width("size"))}  ${pad("budget", width("budget"))}  ${pad("vs budget", width("delta"))}`,
  );
  for (const row of rows) {
    lines.push(
      `${row.mark}${pad(row.id, width("id"))}  ${pad(row.size, width("size"))}  ${pad(row.budget, width("budget"))}  ${pad(row.delta, width("delta"))}  ${row.note}`,
    );
  }
  lines.push("");
  lines.push(
    verdict.failed
      ? "FAIL — see docs/bundle-budget.md for what each id measures and when raising one is the right call."
      : "PASS — every budget met.",
  );
  return `${lines.join("\n")}\n`;
}

/** GitHub-flavoured Markdown for the job summary. */
export function formatMarkdown(verdict: Verdict): string {
  const lines = [
    `### Bundle budget — ${verdict.failed ? "❌ failed" : "✅ passed"}`,
    "",
    `Sizes are **${verdict.compression}**, measured from \`dist/\` against \`bundle-budget.json\`.`,
    "",
    "| | id | size | budget | vs budget | |",
    "| --- | --- | ---: | ---: | ---: | --- |",
  ];
  for (const f of verdict.findings) {
    const mark = f.status === "ok" ? "✅" : "❌";
    const size = f.actual === null ? "—" : formatBytes(f.actual);
    const budget = f.budget === null ? "—" : formatBytes(f.budget);
    const note = f.status === "ok" ? f.detail : `**${EXPLANATIONS[f.status]}** — ${f.detail}`;
    lines.push(`| ${mark} | \`${f.id}\` | ${size} | ${budget} | ${formatDelta(f)} | ${note} |`);
  }
  lines.push("");
  lines.push(
    "See [`docs/bundle-budget.md`](../blob/HEAD/docs/bundle-budget.md) for what each id measures.",
  );
  return `${lines.join("\n")}\n`;
}
