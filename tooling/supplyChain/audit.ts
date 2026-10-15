import { execFile } from "node:child_process";

/**
 * The advisory half of the gate: `pnpm audit`, read as data.
 *
 * `pnpm audit` is the `npm audit` this repository can actually run — both ask
 * the same registry endpoint, and npm's own command needs an npm install tree
 * that a pnpm repository does not have. Two properties of the command shape
 * everything here:
 *
 * - **Exit 1 means "found advisories", not "failed to run".** Treating a
 *   non-zero exit as a crash would make every vulnerable tree look like a
 *   broken gate; treating it as success would be worse. The exit code is
 *   ignored and the report is parsed, so the gate's verdict comes from the
 *   advisories and the policy rather than from pnpm's own severity threshold.
 * - **A report that will not parse has to fail.** Offline, behind a proxy that
 *   returns HTML, or with a pnpm whose `--json` shape has moved, the output is
 *   not a report. The one unacceptable reading is "no advisories found".
 */

export type Severity = "info" | "low" | "moderate" | "high" | "critical";

export const SEVERITY_ORDER: readonly Severity[] = [
  "info",
  "low",
  "moderate",
  "high",
  "critical",
] as const;

export function isSeverity(value: unknown): value is Severity {
  return typeof value === "string" && (SEVERITY_ORDER as readonly string[]).includes(value);
}

export function severityRank(severity: Severity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

export interface Advisory {
  /**
   * The GHSA identifier, which is the only stable key in the report: the
   * numeric `id` differs between the `actions` and `advisories` sections of
   * one run, so an allowlist keyed on it would silently stop matching.
   */
  ghsa: string;
  module: string;
  severity: Severity;
  title: string;
  url: string;
  vulnerableVersions: string;
  patchedVersions: string;
  /** Installed versions the advisory applies to. */
  versions: readonly string[];
  /** One dependency path per finding, for the report. */
  paths: readonly string[];
}

export interface AuditReport {
  advisories: readonly Advisory[];
  /** `metadata.vulnerabilities`, which is pnpm's own count by severity. */
  counts: Readonly<Record<Severity, number>>;
}

function readString(record: Record<string, unknown>, key: string, fallback = ""): string {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

/**
 * Parse `pnpm audit --json`.
 *
 * Deliberately strict about `metadata.vulnerabilities`: it is the field that
 * distinguishes a real report with nothing in it from a response that merely
 * failed to contain advisories. Without that distinction a proxy error page
 * and a clean tree are the same input.
 */
export function parseAuditReport(stdout: string, source: string): AuditReport {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout) as unknown;
  } catch (cause) {
    throw new Error(
      `${source} did not produce JSON. The first 200 characters were: ` +
        JSON.stringify(stdout.slice(0, 200)),
      { cause },
    );
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${source} did not produce a JSON object`);
  }
  const report = raw as Record<string, unknown>;

  const metadata = report.metadata;
  if (typeof metadata !== "object" || metadata === null) {
    throw new Error(
      `${source} returned no "metadata" block, so this is not an audit report. A report with ` +
        `no advisories still carries one; its absence means the audit did not run.`,
    );
  }
  const rawCounts = (metadata as Record<string, unknown>).vulnerabilities;
  if (typeof rawCounts !== "object" || rawCounts === null) {
    throw new Error(`${source}: "metadata.vulnerabilities" is missing`);
  }
  const counts: Record<Severity, number> = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
  };
  for (const severity of SEVERITY_ORDER) {
    const value = (rawCounts as Record<string, unknown>)[severity];
    if (typeof value === "number") counts[severity] = value;
  }

  const advisories: Advisory[] = [];
  const block = report.advisories;
  if (typeof block === "object" && block !== null) {
    for (const [key, value] of Object.entries(block as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const advisory = value as Record<string, unknown>;
      const severity = advisory.severity;
      if (!isSeverity(severity)) {
        throw new Error(
          `${source}: advisory ${key} has severity ${JSON.stringify(severity)}, which is not one ` +
            `of ${SEVERITY_ORDER.join(", ")}`,
        );
      }
      const versions = new Set<string>();
      const paths = new Set<string>();
      const findings = advisory.findings;
      if (Array.isArray(findings)) {
        for (const finding of findings) {
          if (typeof finding !== "object" || finding === null) continue;
          const { version, paths: findingPaths } = finding as Record<string, unknown>;
          if (typeof version === "string") versions.add(version);
          if (Array.isArray(findingPaths)) {
            for (const p of findingPaths) if (typeof p === "string") paths.add(p);
          }
        }
      }
      advisories.push({
        // `github_advisory_id` is absent only for a registry that serves its
        // own advisories; the numeric key is the honest fallback there.
        ghsa: readString(advisory, "github_advisory_id", key),
        module: readString(advisory, "module_name", "unknown"),
        severity,
        title: readString(advisory, "title"),
        url: readString(advisory, "url"),
        vulnerableVersions: readString(advisory, "vulnerable_versions"),
        patchedVersions: readString(advisory, "patched_versions"),
        versions: [...versions].sort(),
        paths: [...paths].sort(),
      });
    }
  }

  advisories.sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      a.module.localeCompare(b.module) ||
      a.ghsa.localeCompare(b.ghsa),
  );
  return { advisories, counts };
}

/**
 * Run `pnpm audit --json` and hand back its stdout.
 *
 * `--audit-level` is deliberately not passed. It makes pnpm choose which
 * advisories to report, which would put the severity policy in two places —
 * the workflow invocation and the policy file — and the one in the workflow
 * is the one nobody reads. pnpm reports everything; the policy decides.
 */
export function runPnpmAudit(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "pnpm",
      ["audit", "--json"],
      // 16MB: the default 1MB truncates the report on a tree with many
      // advisories, and a truncated report is one that will not parse.
      { cwd, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        // Exit 1 is "advisories found" and arrives here as an error with the
        // report still on stdout, which is the case this whole callback exists
        // to get right.
        if (stdout.trim() !== "") {
          resolve(stdout);
          return;
        }
        reject(
          new Error(
            `\`pnpm audit --json\` produced no output. stderr was: ` +
              JSON.stringify(stderr.slice(0, 500)),
            error === null ? undefined : { cause: error },
          ),
        );
      },
    );
  });
}
