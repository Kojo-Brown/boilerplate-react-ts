import { isSeverity, severityRank, type Advisory, type Severity } from "./audit.ts";
import type { LockedPackage } from "./lockfile.ts";
import type { VersionMetadata } from "./registry.ts";
import type { SignatureCheck } from "./signature.ts";

/**
 * The policy file, and what it means to fail it.
 *
 * `supply-chain-policy.json` holds three decisions, and each is in the file
 * rather than in the workflow for the same reason the bundle budget is: a
 * threshold passed on a command line is changed by whoever is trying to get
 * the build green, in a diff that reads as a CI tweak. A threshold in a
 * committed file is changed in a diff that reads as a decision.
 *
 * The three:
 *
 * - **`audit.failOn`** — the severity at or above which an advisory fails the
 *   build. `moderate`. `high` is the common choice and it is too loose: it
 *   lets a moderate path-traversal in the test runner sit unreported
 *   indefinitely. `low` is too tight for a dependency tree that is 90%
 *   development tooling — a steady drip of low-severity denial-of-service
 *   advisories in transitive build dependencies would make the gate something
 *   people route around, and a gate people route around is worse than a looser
 *   one they trust.
 *
 * - **`audit.allow`** — suppressions, each with a reason and an expiry. The
 *   expiry is the whole point: a suppression without one is how a tree ends up
 *   with a four-year-old critical nobody remembers accepting. An expired entry
 *   stops suppressing, and an entry that matches nothing fails, so the list
 *   cannot quietly accumulate.
 *
 * - **`provenance.attested`** — the packages observed to publish SLSA
 *   provenance. A ratchet, not a requirement: 43% of this tree has provenance
 *   (207 of 482), so requiring it outright would mean deleting most of the
 *   dependency list. What is enforceable, and worth far more, is that coverage
 *   does not go *backwards* — a package that published provenance and then
 *   stops is either a compromised release pipeline or a maintainer handover,
 *   and both are worth a human reading the diff.
 */

export interface AllowEntry {
  advisory: string;
  reason: string;
  /** ISO date; the entry stops suppressing at the end of this day, UTC. */
  expires: string;
}

export interface Policy {
  registry: string;
  audit: {
    failOn: Severity;
    allow: readonly AllowEntry[];
  };
  provenance: {
    attested: readonly string[];
  };
}

export type FindingArea = "registry" | "advisory" | "provenance";

export type FindingStatus =
  // registry
  | "ok"
  | "off-registry"
  | "no-integrity"
  | "integrity-mismatch"
  | "no-signature"
  | "bad-signature"
  | "unknown-key"
  | "unsupported-scheme"
  | "malformed-signature"
  | "retired-key"
  // advisory
  | "advisory"
  | "advisory-allowed"
  | "allow-expired"
  | "allow-unused"
  // provenance
  | "provenance-lost"
  | "provenance-unrecorded"
  | "provenance-stale";

export interface Finding {
  area: FindingArea;
  /** `name@version`, a GHSA id, or a package name, depending on the area. */
  subject: string;
  status: FindingStatus;
  detail: string;
  failed: boolean;
}

export interface Verdict {
  findings: readonly Finding[];
  /** Packages whose registry checks all passed, for the summary line. */
  verified: number;
  checked: number;
  failed: boolean;
}

/** One package, with everything the registry said about it. */
export interface PackageVerification {
  pkg: LockedPackage;
  /** `null` for a package not resolved from the registry. */
  metadata: VersionMetadata | null;
  signatures: SignatureCheck | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parsePolicy(contents: string, source: string): Policy {
  let raw: unknown;
  try {
    raw = JSON.parse(contents) as unknown;
  } catch (cause) {
    throw new Error(`${source} is not valid JSON`, { cause });
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${source} must contain a JSON object`);
  }
  const record = raw as Record<string, unknown>;

  const registry = record.registry;
  if (typeof registry !== "string" || !/^https:\/\//.test(registry)) {
    // Plain `http` is refused rather than warned about: every guarantee below
    // this line is a statement fetched over that connection.
    throw new Error(`${source}: "registry" must be an https URL`);
  }

  const auditBlock = record.audit;
  if (typeof auditBlock !== "object" || auditBlock === null || Array.isArray(auditBlock)) {
    throw new Error(`${source}: "audit" must be an object`);
  }
  const { failOn, allow } = auditBlock as Record<string, unknown>;
  if (!isSeverity(failOn)) {
    throw new Error(`${source}: "audit.failOn" must be one of info, low, moderate, high, critical`);
  }
  if (!Array.isArray(allow)) {
    throw new Error(`${source}: "audit.allow" must be an array (use [] for none)`);
  }
  const entries: AllowEntry[] = allow.map((entry, index) => {
    const where = `${source}: audit.allow[${index}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`${where} must be an object`);
    }
    const { advisory, reason, expires } = entry as Record<string, unknown>;
    if (typeof advisory !== "string" || advisory === "") {
      throw new Error(`${where}: "advisory" must be the advisory id, e.g. "GHSA-xxxx-xxxx-xxxx"`);
    }
    // A reason long enough to be a sentence. "known issue" is not a reason,
    // and a suppression nobody had to justify is one nobody will revisit.
    if (typeof reason !== "string" || reason.trim().length < 20) {
      throw new Error(
        `${where}: "reason" must explain why ${advisory} is accepted, in at least 20 characters`,
      );
    }
    if (typeof expires !== "string" || !ISO_DATE.test(expires)) {
      throw new Error(`${where}: "expires" must be a YYYY-MM-DD date`);
    }
    if (Number.isNaN(Date.parse(expires))) {
      throw new Error(`${where}: "expires" is not a real date`);
    }
    return { advisory, reason, expires };
  });

  const provenanceBlock = record.provenance;
  if (
    typeof provenanceBlock !== "object" ||
    provenanceBlock === null ||
    Array.isArray(provenanceBlock)
  ) {
    throw new Error(`${source}: "provenance" must be an object`);
  }
  const { attested } = provenanceBlock as Record<string, unknown>;
  if (!Array.isArray(attested) || attested.some((name) => typeof name !== "string")) {
    throw new Error(`${source}: "provenance.attested" must be an array of package names`);
  }
  const names = attested as string[];
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate !== undefined) {
    throw new Error(`${source}: "provenance.attested" lists ${duplicate} twice`);
  }

  return {
    registry,
    audit: { failOn, allow: entries },
    provenance: { attested: names },
  };
}

export function formatPolicy(policy: Policy): string {
  return `${JSON.stringify(
    {
      registry: policy.registry,
      audit: {
        failOn: policy.audit.failOn,
        allow: policy.audit.allow,
      },
      provenance: { attested: [...policy.provenance.attested].sort() },
    },
    null,
    2,
  )}\n`;
}

/** An allow entry is live until the end of its `expires` day, UTC. */
export function isAllowLive(entry: AllowEntry, now: Date): boolean {
  return Date.parse(`${entry.expires}T23:59:59.999Z`) >= now.getTime();
}

function registryFindings(verifications: readonly PackageVerification[]): Finding[] {
  const findings: Finding[] = [];
  for (const { pkg, metadata, signatures } of verifications) {
    const subject = `${pkg.name}@${pkg.version}`;

    if (pkg.kind !== "registry") {
      findings.push({
        area: "registry",
        subject,
        status: "off-registry",
        // Not a hole in the gate — the finding *is* the point. A git or file
        // resolution has no publisher signature and no immutable version, so
        // none of the checks below can be run against it at all.
        detail:
          `resolved as ${pkg.kind}${pkg.location === null ? "" : ` from ${pkg.location}`}, ` +
          `which carries no registry signature`,
        failed: true,
      });
      continue;
    }

    if (pkg.integrity === null) {
      findings.push({
        area: "registry",
        subject,
        status: "no-integrity",
        detail: "the lockfile records no integrity hash for this package",
        failed: true,
      });
      continue;
    }

    if (metadata === null || signatures === null) {
      findings.push({
        area: "registry",
        subject,
        status: "no-signature",
        detail: "the registry returned no metadata for this version",
        failed: true,
      });
      continue;
    }

    if (metadata.integrity !== pkg.integrity) {
      findings.push({
        area: "registry",
        subject,
        status: "integrity-mismatch",
        detail:
          `the lockfile pins ${pkg.integrity.slice(0, 24)}… and the registry serves ` +
          (metadata.integrity === null ? "no integrity" : `${metadata.integrity.slice(0, 24)}…`),
        failed: true,
      });
      continue;
    }

    if (signatures.verdict !== "ok") {
      findings.push({
        area: "registry",
        subject,
        status: signatures.verdict,
        detail:
          signatures.attempts.length === 0
            ? "the registry published no signature for this version"
            : `signature verdicts: ${signatures.attempts.join(", ")}`,
        failed: true,
      });
      continue;
    }

    findings.push({
      area: "registry",
      subject,
      status: signatures.viaRetiredKey ? "retired-key" : "ok",
      detail: signatures.viaRetiredKey
        ? "integrity matches a valid signature made under npm's retired key, which is " +
          "expected for a version published before the 2025-01-29 rotation"
        : "integrity matches a valid registry signature",
      failed: false,
    });
  }
  return findings;
}

function advisoryFindings(advisories: readonly Advisory[], policy: Policy, now: Date): Finding[] {
  const findings: Finding[] = [];
  const floor = severityRank(policy.audit.failOn);
  const matched = new Set<string>();

  for (const advisory of advisories) {
    const entry = policy.audit.allow.find((a) => a.advisory === advisory.ghsa);
    const atOrAboveFloor = severityRank(advisory.severity) >= floor;
    if (entry !== undefined) {
      matched.add(entry.advisory);
      if (isAllowLive(entry, now)) {
        findings.push({
          area: "advisory",
          subject: advisory.ghsa,
          status: "advisory-allowed",
          detail:
            `${advisory.severity} in ${advisory.module} ${advisory.vulnerableVersions}, ` +
            `accepted until ${entry.expires}: ${entry.reason}`,
          failed: false,
        });
        continue;
      }
      findings.push({
        area: "advisory",
        subject: advisory.ghsa,
        status: "allow-expired",
        detail:
          `the suppression expired on ${entry.expires} and no longer applies — ` +
          `fix ${advisory.module}, or renew the entry with a current reason`,
        failed: true,
      });
      // Fall through: an expired suppression leaves the advisory itself to be
      // reported on its own terms below.
    }

    findings.push({
      area: "advisory",
      subject: advisory.ghsa,
      status: "advisory",
      detail:
        `${advisory.severity} in ${advisory.module} ${advisory.vulnerableVersions} ` +
        `(installed ${advisory.versions.join(", ") || "unknown"}; ` +
        `fixed in ${advisory.patchedVersions || "no published fix"}) — ${advisory.title}`,
      failed: atOrAboveFloor,
    });
  }

  for (const entry of policy.audit.allow) {
    if (matched.has(entry.advisory)) continue;
    findings.push({
      area: "advisory",
      subject: entry.advisory,
      status: "allow-unused",
      detail:
        "this suppression matches no advisory in the current tree — the dependency was " +
        "fixed or removed, so the entry should go too",
      failed: true,
    });
  }

  return findings;
}

function provenanceFindings(
  verifications: readonly PackageVerification[],
  policy: Policy,
): Finding[] {
  const findings: Finding[] = [];
  const recorded = new Set(policy.provenance.attested);
  // Keyed by name, not name@version: a version bump that drops provenance is
  // precisely the regression worth catching, and keying on the version would
  // make every bump look like a new package instead.
  const observed = new Map<string, boolean>();
  for (const { pkg, metadata } of verifications) {
    const has = metadata?.provenance !== null && metadata?.provenance !== undefined;
    observed.set(pkg.name, (observed.get(pkg.name) ?? false) || has);
  }

  for (const [name, has] of [...observed].sort(([a], [b]) => a.localeCompare(b))) {
    if (recorded.has(name) && !has) {
      findings.push({
        area: "provenance",
        subject: name,
        status: "provenance-lost",
        detail:
          "published SLSA provenance when this baseline was recorded and does not now — " +
          "check who published the current version and from where before accepting it",
        failed: true,
      });
      continue;
    }
    if (!recorded.has(name) && has) {
      findings.push({
        area: "provenance",
        subject: name,
        status: "provenance-unrecorded",
        detail:
          "publishes SLSA provenance but is not in the baseline — run " +
          "`pnpm supply-chain:update` so the guarantee is recorded and can be held",
        failed: true,
      });
      continue;
    }
    if (recorded.has(name)) {
      findings.push({
        area: "provenance",
        subject: name,
        status: "ok",
        detail: "publishes SLSA provenance, as recorded",
        failed: false,
      });
    }
  }

  for (const name of [...recorded].sort()) {
    if (observed.has(name)) continue;
    findings.push({
      area: "provenance",
      subject: name,
      status: "provenance-stale",
      detail:
        "is in the baseline but no longer in the lockfile — run `pnpm supply-chain:update` " +
        "so the baseline stops claiming coverage it does not have",
      failed: true,
    });
  }

  return findings;
}

export function evaluate(
  verifications: readonly PackageVerification[],
  advisories: readonly Advisory[],
  policy: Policy,
  now: Date,
): Verdict {
  const registry = registryFindings(verifications);
  const findings = [
    ...registry,
    ...advisoryFindings(advisories, policy, now),
    ...provenanceFindings(verifications, policy),
  ];
  return {
    findings,
    verified: registry.filter((f) => !f.failed).length,
    checked: verifications.length,
    failed: findings.some((f) => f.failed),
  };
}

/** The policy this run would have passed, for `--update`. */
export function ratchet(
  verifications: readonly PackageVerification[],
  policy: Policy,
  now: Date,
): Policy {
  const attested = new Set<string>();
  for (const { pkg, metadata } of verifications) {
    if (metadata?.provenance !== null && metadata?.provenance !== undefined) {
      attested.add(pkg.name);
    }
  }
  return {
    ...policy,
    // Expired suppressions are dropped rather than renewed: renewing one is a
    // decision with a reason attached, which is a human's to write.
    audit: { ...policy.audit, allow: policy.audit.allow.filter((e) => isAllowLive(e, now)) },
    provenance: { attested: [...attested].sort() },
  };
}
