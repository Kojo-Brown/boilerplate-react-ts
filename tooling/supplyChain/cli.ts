import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { parseAuditReport, runPnpmAudit, type Advisory } from "./audit.ts";
import {
  evaluate,
  formatPolicy,
  parsePolicy,
  ratchet,
  type PackageVerification,
  type Policy,
} from "./evaluate.ts";
import { parseLockfile, type LockedPackage } from "./lockfile.ts";
import { fetchKeys, fetchVersionMetadata, mapWithConcurrency, type FetchLike } from "./registry.ts";
import { formatMarkdown, formatText } from "./report.ts";
import { checkSignatures, keysById } from "./signature.ts";

/**
 * `pnpm supply-chain` — the gate itself.
 *
 * Three checks over one dependency tree, in the order that fails cheapest
 * first:
 *
 * 1. Every package in `pnpm-lock.yaml` resolves from the registry, and the
 *    integrity this repository has committed matches a valid npm publisher
 *    signature for that exact name and version.
 * 2. `pnpm audit` reports nothing at or above the policy's severity floor
 *    that is not explicitly, temporarily accepted.
 * 3. No package that published SLSA provenance has stopped.
 *
 * It needs the network, and that is a deliberate cost rather than an
 * oversight: the signatures and advisories are statements the registry makes
 * *now*, and a version of this check that could run from a cache would be
 * answering last week's question. What it must never do is treat an
 * unreachable registry as a pass, so every failure to read is an error.
 */

export const DEFAULT_CONCURRENCY = 12;

export interface Io {
  log: (line: string) => void;
  error: (line: string) => void;
}

interface Options {
  lockfile: string;
  policy: string;
  update: boolean;
  concurrency: number;
  summary: string | null;
  /** Skip `pnpm audit`. For `--update`, which only needs registry metadata. */
  skipAudit: boolean;
}

const USAGE = `Usage: node tooling/supplyChain/cli.ts [options]

  --lockfile <file>   Lockfile to read (default: pnpm-lock.yaml)
  --policy <file>     Policy file (default: supply-chain-policy.json)
  --summary <file>    Append a Markdown report to this file (use $GITHUB_STEP_SUMMARY)
  --update            Rewrite the provenance baseline from this tree instead of checking it
  --concurrency <n>   Registry requests in flight (default: ${DEFAULT_CONCURRENCY})
  --skip-audit        Skip \`pnpm audit\`; check signatures and provenance only
`;

export function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    lockfile: "pnpm-lock.yaml",
    policy: "supply-chain-policy.json",
    update: false,
    concurrency: DEFAULT_CONCURRENCY,
    summary: null,
    skipAudit: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg ?? ""} needs a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--lockfile":
        options.lockfile = next();
        break;
      case "--policy":
        options.policy = next();
        break;
      case "--summary":
        options.summary = next();
        break;
      case "--update":
        options.update = true;
        break;
      case "--skip-audit":
        options.skipAudit = true;
        break;
      case "--concurrency": {
        const value = Number(next());
        if (!Number.isInteger(value) || value < 1) {
          throw new Error("--concurrency must be a positive integer");
        }
        options.concurrency = value;
        break;
      }
      default:
        throw new Error(`Unknown argument "${arg ?? ""}"\n\n${USAGE}`);
    }
  }
  return options;
}

export interface VerifyDeps {
  fetch: FetchLike;
  now: Date;
  concurrency: number;
}

/**
 * Ask the registry about every package and check what comes back.
 *
 * Exported for the test that runs it against a stubbed registry: the
 * interesting cases — a tampered integrity, a signature under a retired key —
 * cannot be produced by asking npm nicely.
 */
export async function verifyPackages(
  packages: readonly LockedPackage[],
  policy: Policy,
  deps: VerifyDeps,
): Promise<PackageVerification[]> {
  const keys = keysById(await fetchKeys({ fetch: deps.fetch, registry: policy.registry }));

  return mapWithConcurrency(packages, deps.concurrency, async (pkg) => {
    if (pkg.kind !== "registry" || pkg.integrity === null) {
      return { pkg, metadata: null, signatures: null };
    }
    const metadata = await fetchVersionMetadata(pkg.name, pkg.version, {
      fetch: deps.fetch,
      registry: policy.registry,
    });
    const signatures = checkSignatures(
      { name: pkg.name, version: pkg.version, integrity: pkg.integrity },
      metadata.signatures,
      keys,
      deps.now,
    );
    return { pkg, metadata, signatures };
  });
}

export interface MainDeps {
  io: Io;
  fetch: FetchLike;
  now: Date;
  /** Injected so the end-to-end test does not shell out to pnpm. */
  audit: (cwd: string) => Promise<string>;
  cwd: string;
}

export async function main(argv: readonly string[], deps: MainDeps): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    deps.io.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  try {
    const policy = parsePolicy(readFileSync(options.policy, "utf8"), options.policy);
    const packages = parseLockfile(readFileSync(options.lockfile, "utf8"), options.lockfile);

    const verifications = await verifyPackages(packages, policy, {
      fetch: deps.fetch,
      now: deps.now,
      concurrency: options.concurrency,
    });

    if (options.update) {
      const updated = ratchet(verifications, policy, deps.now);
      writeFileSync(options.policy, formatPolicy(updated));
      const added = updated.provenance.attested.filter(
        (name) => !policy.provenance.attested.includes(name),
      );
      const removed = policy.provenance.attested.filter(
        (name) => !updated.provenance.attested.includes(name),
      );
      deps.io.log(
        `Wrote ${options.policy}: ${updated.provenance.attested.length} package(s) with ` +
          `provenance (+${added.length}, -${removed.length}). Review the diff — a package ` +
          `that lost provenance is a finding, not a formality.`,
      );
      if (removed.length > 0) deps.io.log(`  no longer attested: ${removed.join(", ")}`);
      return 0;
    }

    let advisories: readonly Advisory[] = [];
    if (!options.skipAudit) {
      const stdout = await deps.audit(deps.cwd);
      advisories = parseAuditReport(stdout, "`pnpm audit --json`").advisories;
    }

    const verdict = evaluate(verifications, advisories, policy, deps.now);
    deps.io.log(formatText(verdict));
    if (options.summary !== null) appendFileSync(options.summary, formatMarkdown(verdict));
    return verdict.failed ? 1 : 0;
  } catch (error) {
    deps.io.error(error instanceof Error ? error.message : String(error));
    // The cause carries the actual network or parse error, and losing it turns
    // every registry outage into a bare "fetch failed". `String()` on an
    // arbitrary cause yields "[object Object]", so unwrap an Error first.
    const cause = error instanceof Error ? error.cause : undefined;
    if (cause !== undefined) {
      deps.io.error(
        `  caused by: ${cause instanceof Error ? cause.message : JSON.stringify(cause)}`,
      );
    }
    return 2;
  }
}

if (process.argv[1] === import.meta.filename) {
  process.exitCode = await main(process.argv.slice(2), {
    io: {
      log: (line) => {
        process.stdout.write(`${line}\n`);
      },
      error: (line) => {
        process.stderr.write(`${line}\n`);
      },
    },
    fetch: (url) => fetch(url),
    now: new Date(),
    audit: runPnpmAudit,
    cwd: process.cwd(),
  });
}
