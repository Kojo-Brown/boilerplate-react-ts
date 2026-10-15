import type { Finding, FindingArea, Verdict } from "./evaluate.ts";

/**
 * Rendering the verdict.
 *
 * Two audiences, as with the bundle budget. The terminal output is for
 * whoever has to fix it and leads with the failures; the Markdown is for
 * `$GITHUB_STEP_SUMMARY`, where the counts are worth reading even on a green
 * run — "482 packages verified against a registry signature" is the sentence
 * that tells a reviewer the gate actually ran, and its absence is the only
 * way to notice a gate that has quietly stopped checking anything.
 *
 * Passing findings are counted, never listed. One line per verified package
 * is 482 lines of log nobody reads, and a report nobody reads is where a
 * failure goes to hide.
 */

const AREA_LABEL: Record<FindingArea, string> = {
  registry: "Registry integrity & signatures",
  advisory: "Advisories",
  provenance: "Provenance baseline",
};

const AREAS: readonly FindingArea[] = ["registry", "advisory", "provenance"];

/** What to do about each status, in the imperative. */
const REMEDIES: Record<Finding["status"], string> = {
  ok: "",
  "off-registry": "pin this to a registry release, or vendor it deliberately",
  "no-integrity": "delete the lockfile entry and reinstall so pnpm records a hash",
  "integrity-mismatch":
    "the committed hash is not what the registry serves — do not install until you know why",
  "no-signature": "no publisher signature exists for this version; pick one that has it",
  "bad-signature": "the signature does not verify — treat this as a compromised artefact",
  "unknown-key": "signed by a key the registry does not publish",
  "retired-key": "",
  "unsupported-scheme": "signed with a scheme this gate cannot verify",
  "malformed-signature": "the signature is not a well-formed ECDSA signature",
  advisory: "update the dependency, or allow it in supply-chain-policy.json with a reason",
  "advisory-allowed": "",
  "allow-expired": "fix the advisory, or renew the suppression with a current justification",
  "allow-unused": "remove the entry from supply-chain-policy.json",
  "provenance-lost": "confirm the new release is legitimate before accepting it",
  "provenance-unrecorded": "run `pnpm supply-chain:update`",
  "provenance-stale": "run `pnpm supply-chain:update`",
};

function failuresIn(verdict: Verdict, area: FindingArea): Finding[] {
  return verdict.findings.filter((f) => f.area === area && f.failed);
}

/** Findings that pass but are worth saying out loud. */
function notesIn(verdict: Verdict, area: FindingArea): Finding[] {
  return verdict.findings.filter(
    (f) => f.area === area && !f.failed && f.status === "advisory-allowed",
  );
}

/** Verified, but under the key npm retired in 2025. Expected, and worth stating. */
export function retiredKeyCount(verdict: Verdict): number {
  return verdict.findings.filter((f) => f.status === "retired-key").length;
}

export function formatText(verdict: Verdict): string {
  const retired = retiredKeyCount(verdict);
  const lines: string[] = [];
  lines.push(
    `Supply chain: ${verdict.verified}/${verdict.checked} packages verified against a ` +
      `registry signature` +
      (retired === 0 ? "." : `, ${retired} of them under npm's retired signing key.`),
  );

  for (const area of AREAS) {
    const failures = failuresIn(verdict, area);
    const notes = notesIn(verdict, area);
    if (failures.length === 0 && notes.length === 0) continue;
    lines.push("", `${AREA_LABEL[area]}:`);
    for (const finding of notes) {
      lines.push(`  accepted  ${finding.subject}  ${finding.detail}`);
    }
    for (const finding of failures) {
      lines.push(`  FAIL  ${finding.subject}  [${finding.status}]  ${finding.detail}`);
      const remedy = REMEDIES[finding.status];
      if (remedy !== "") lines.push(`        → ${remedy}`);
    }
  }

  const total = verdict.findings.filter((f) => f.failed).length;
  lines.push(
    "",
    verdict.failed
      ? `${total} finding${total === 1 ? "" : "s"} must be resolved.`
      : "No supply-chain findings.",
  );
  return lines.join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

export function formatMarkdown(verdict: Verdict): string {
  const retired = retiredKeyCount(verdict);
  const lines: string[] = ["## Supply chain", ""];
  lines.push(
    verdict.failed
      ? `❌ ${verdict.findings.filter((f) => f.failed).length} finding(s).`
      : "✅ No findings.",
    "",
    `\`${verdict.verified}\` of \`${verdict.checked}\` packages verified: the integrity in ` +
      `\`pnpm-lock.yaml\` matches a valid npm registry signature.` +
      (retired === 0
        ? ""
        : ` \`${retired}\` of those are signed under the key npm retired on 2025-01-29, which` +
          ` is expected for versions published before the rotation.`),
    "",
  );

  const provenanceOk = verdict.findings.filter(
    (f) => f.area === "provenance" && f.status === "ok",
  ).length;
  lines.push(
    `\`${provenanceOk}\` package(s) publish SLSA provenance, as recorded in the baseline.`,
    "",
  );

  for (const area of AREAS) {
    const failures = failuresIn(verdict, area);
    const notes = notesIn(verdict, area);
    if (failures.length === 0 && notes.length === 0) continue;
    lines.push(
      `### ${AREA_LABEL[area]}`,
      "",
      "| | Subject | Finding | What to do |",
      "|---|---|---|---|",
    );
    for (const finding of notes) {
      lines.push(
        `| accepted | \`${escapeCell(finding.subject)}\` | ${escapeCell(finding.detail)} | — |`,
      );
    }
    for (const finding of failures) {
      lines.push(
        `| ❌ \`${finding.status}\` | \`${escapeCell(finding.subject)}\` | ` +
          `${escapeCell(finding.detail)} | ${escapeCell(REMEDIES[finding.status])} |`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
