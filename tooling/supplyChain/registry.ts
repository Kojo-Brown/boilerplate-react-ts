import { parseKeys, type PackageSignature, type RegistryKey } from "./signature.ts";

/**
 * What the gate reads from the registry, and how it fails when it cannot.
 *
 * Every function here takes `fetch` as an argument. That is what lets the
 * evaluation be tested against a tree of 400 packages without a network, and
 * it is also the seam where the one rule that matters is enforced: a request
 * that fails is an error, never an absent result. A supply-chain check that
 * degrades to "could not ask, carry on" is worse than no check, because it
 * reports green on exactly the day the registry is having a bad time.
 */

export const DEFAULT_REGISTRY = "https://registry.npmjs.org";
export const KEYS_PATH = "/-/npm/v1/keys";

export interface VersionMetadata {
  /** `dist.integrity`, for comparison against the lockfile's. */
  integrity: string | null;
  signatures: PackageSignature[];
  /** `dist.attestations.provenance.predicateType`, or `null` when absent. */
  provenance: string | null;
}

export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface RegistryOptions {
  fetch: FetchLike;
  registry?: string;
  /** Attempts per request, including the first. */
  attempts?: number;
  /** Backoff before retry n, in milliseconds. Injected so tests do not wait. */
  delay?: (ms: number) => Promise<void>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * One request, retried on the failures that are worth retrying.
 *
 * A 5xx or a thrown connection error is retried; a 404 is not, because a
 * version the registry does not have is an answer, not an outage, and it is an
 * answer the gate must report rather than retry past.
 */
async function getJson(url: string, options: RegistryOptions): Promise<unknown> {
  const attempts = options.attempts ?? 3;
  const delay = options.delay ?? sleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await options.fetch(url);
      if (response.ok) return await response.json();
      if (response.status < 500) {
        throw new Error(`${url} responded ${response.status}`);
      }
      lastError = new Error(`${url} responded ${response.status}`);
    } catch (error) {
      lastError = error;
      // A non-retryable status was turned into a throw just above; rethrow it
      // rather than spending the remaining attempts on a settled answer.
      if (error instanceof Error && /responded 4\d\d$/.test(error.message)) throw error;
    }
    if (attempt < attempts) await delay(2 ** (attempt - 1) * 250);
  }
  throw lastError instanceof Error ? lastError : new Error(`${url} could not be read`);
}

export async function fetchKeys(options: RegistryOptions): Promise<RegistryKey[]> {
  const registry = options.registry ?? DEFAULT_REGISTRY;
  const url = `${registry}${KEYS_PATH}`;
  return parseKeys(await getJson(url, options), url);
}

function readVersionMetadata(raw: unknown, source: string): VersionMetadata {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${source} did not return a JSON object`);
  }
  const dist = (raw as Record<string, unknown>).dist;
  if (typeof dist !== "object" || dist === null) {
    throw new Error(`${source} returned no "dist" block`);
  }
  const { integrity, signatures, attestations } = dist as Record<string, unknown>;

  const parsedSignatures: PackageSignature[] = [];
  if (Array.isArray(signatures)) {
    for (const entry of signatures) {
      if (typeof entry !== "object" || entry === null) continue;
      const { keyid, sig } = entry as Record<string, unknown>;
      if (typeof keyid === "string" && typeof sig === "string") {
        parsedSignatures.push({ keyid, sig });
      }
    }
  }

  let provenance: string | null = null;
  if (typeof attestations === "object" && attestations !== null) {
    const block = (attestations as Record<string, unknown>).provenance;
    if (typeof block === "object" && block !== null) {
      const predicateType = (block as Record<string, unknown>).predicateType;
      provenance = typeof predicateType === "string" ? predicateType : null;
    }
  }

  return {
    integrity: typeof integrity === "string" ? integrity : null,
    signatures: parsedSignatures,
    provenance,
  };
}

/** The per-version document, which carries `dist` for exactly one version. */
export async function fetchVersionMetadata(
  name: string,
  version: string,
  options: RegistryOptions,
): Promise<VersionMetadata> {
  const registry = options.registry ?? DEFAULT_REGISTRY;
  // The name is the only user-controlled part of the path and a scope's `/`
  // must survive, so each segment is encoded on its own.
  const encoded = name
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = `${registry}/${encoded}/${encodeURIComponent(version)}`;
  return readVersionMetadata(await getJson(url, options), url);
}

/**
 * Map over items with a bounded number of requests in flight.
 *
 * Bounded rather than `Promise.all` over 480 packages: the registry answers
 * a burst that size with 429s, and a gate that intermittently rate-limits
 * itself is a gate people start re-running until it passes.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) throw new Error("concurrency limit must be at least 1");
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await fn(item);
    }
  });
  await Promise.all(workers);
  return results;
}
