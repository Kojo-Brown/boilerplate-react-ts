import { parse } from "yaml";

/**
 * The installed set, read from `pnpm-lock.yaml`.
 *
 * The lockfile rather than `node_modules` or `pnpm ls --json`, for one reason
 * that decides the whole design: the integrity hash has to come from the file
 * this repository commits. Every other source either lacks it (`pnpm ls` does
 * not report integrity) or takes it from the registry, and a check that asks
 * the registry for an integrity and then verifies the registry's signature
 * over that same integrity proves only that the registry agrees with itself.
 * Comparing the *committed* integrity against a signed registry statement is
 * what makes the check mean "what we install is what the registry signed".
 */

/** Lockfile major versions whose `packages:`/`importers:` shape this reads. */
export const SUPPORTED_LOCKFILE_MAJORS = ["9"] as const;

export type ResolutionKind = "registry" | "tarball" | "git" | "directory" | "unknown";

export interface LockedPackage {
  name: string;
  version: string;
  /** The `sha512-…` integrity, or `null` for a resolution that has none. */
  integrity: string | null;
  kind: ResolutionKind;
  /** Where a non-registry resolution points, for the report. */
  location: string | null;
  /** True when the root importer lists it under `dependencies`. */
  production: boolean;
  /** True when the root importer lists it under `devDependencies`. */
  development: boolean;
}

/** `@scope/name@1.2.3` → name and version. */
export function splitPackageKey(key: string): { name: string; version: string } {
  const at = key.lastIndexOf("@");
  // A leading `@` is a scope, not a separator, so `@scope/name` with no
  // version is malformed rather than a package called `@scope/name`.
  if (at <= 0) throw new Error(`Lockfile package key "${key}" is not name@version`);
  return { name: key.slice(0, at), version: key.slice(at + 1) };
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

/**
 * Classify a `resolution:` block.
 *
 * The three non-registry kinds are reported rather than skipped. A `git:` or
 * `file:` dependency is not a gap in the gate's coverage, it is the thing the
 * gate exists to find: nothing signs a git revision, so a dependency resolved
 * that way carries none of the guarantees the other 400 do, and the only safe
 * default is to say so out loud.
 */
function classify(resolution: Record<string, unknown>): {
  kind: ResolutionKind;
  location: string | null;
} {
  const { type, tarball, repo, directory } = resolution;
  if (type === "git" || typeof repo === "string") {
    return { kind: "git", location: typeof repo === "string" ? repo : null };
  }
  if (type === "directory" || typeof directory === "string") {
    return { kind: "directory", location: typeof directory === "string" ? directory : null };
  }
  if (typeof tarball === "string") return { kind: "tarball", location: tarball };
  if (typeof resolution.integrity === "string") return { kind: "registry", location: null };
  return { kind: "unknown", location: null };
}

function directNames(importers: Record<string, unknown>, field: string): Set<string> {
  const names = new Set<string>();
  for (const importer of Object.values(importers)) {
    if (typeof importer !== "object" || importer === null) continue;
    const block = (importer as Record<string, unknown>)[field];
    if (typeof block !== "object" || block === null) continue;
    for (const name of Object.keys(block)) names.add(name);
  }
  return names;
}

/**
 * Parse `pnpm-lock.yaml` into the set of packages to verify.
 *
 * Strict about the lockfile version, because this reads two specific keys and
 * a format change that renamed either of them would otherwise leave the gate
 * reporting an empty package list — which is to say passing, with nothing
 * checked, in exactly the silence the gate was added to remove.
 */
export function parseLockfile(contents: string, source: string): LockedPackage[] {
  let raw: unknown;
  try {
    raw = parse(contents) as unknown;
  } catch (cause) {
    throw new Error(`${source} is not valid YAML`, { cause });
  }
  const root = asRecord(raw, source);

  const version = root.lockfileVersion;
  const major = String(version).split(".")[0] ?? "";
  if (!SUPPORTED_LOCKFILE_MAJORS.includes(major as (typeof SUPPORTED_LOCKFILE_MAJORS)[number])) {
    throw new Error(
      `${source}: lockfileVersion ${JSON.stringify(version)} is not supported ` +
        `(expected major ${SUPPORTED_LOCKFILE_MAJORS.join(" or ")}). The \`packages:\` and ` +
        `\`importers:\` keys this reads may have moved; check the shape before widening this.`,
    );
  }

  const packages = asRecord(root.packages ?? {}, `${source}: packages`);
  if (Object.keys(packages).length === 0) {
    throw new Error(
      `${source}: \`packages:\` is empty. A lockfile with no packages means nothing would be ` +
        `verified, which must fail rather than pass.`,
    );
  }
  const importers = asRecord(root.importers ?? {}, `${source}: importers`);
  const production = directNames(importers, "dependencies");
  const development = directNames(importers, "devDependencies");

  const parsed: LockedPackage[] = [];
  for (const [key, value] of Object.entries(packages)) {
    const { name, version: packageVersion } = splitPackageKey(key);
    const entry = asRecord(value ?? {}, `${source}: packages["${key}"]`);
    const resolution = asRecord(entry.resolution ?? {}, `${source}: packages["${key}"].resolution`);
    const { kind, location } = classify(resolution);
    const integrity = resolution.integrity;
    parsed.push({
      name,
      version: packageVersion,
      integrity: typeof integrity === "string" ? integrity : null,
      kind,
      location,
      production: production.has(name),
      development: development.has(name),
    });
  }

  parsed.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return parsed;
}
