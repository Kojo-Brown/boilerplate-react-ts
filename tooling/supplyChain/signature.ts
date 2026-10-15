import { createVerify } from "node:crypto";

/**
 * Registry signature verification.
 *
 * npm signs a statement about each published version with an ECDSA P-256 key
 * it publishes at `/-/npm/v1/keys`. The signed payload is the literal string
 * `name@version:integrity`, so a signature that verifies says: *this registry
 * asserts that this exact name and version has this exact tarball hash*.
 *
 * This is `npm audit signatures` by another route. npm's own command reads an
 * npm install tree, which does not exist in a pnpm repository — pnpm's
 * `node_modules` is a symlink farm around a content-addressed store and has no
 * `package-lock.json` for npm to walk. Reimplementing the check over
 * `pnpm-lock.yaml` is what makes it available here at all, and it is a
 * stronger check in one respect: the integrity it verifies is the one this
 * repository has committed, not one npm re-read from the registry.
 */

export interface RegistryKey {
  keyid: string;
  keytype: string;
  scheme: string;
  /** Base64 SPKI, exactly as the registry serves it. */
  key: string;
  /** ISO timestamp, or `null` for a key with no expiry. */
  expires: string | null;
}

export interface PackageSignature {
  keyid: string;
  /** Base64 DER ECDSA signature. */
  sig: string;
}

export const SUPPORTED_SCHEME = "ecdsa-sha2-nistp256";

export type SignatureVerdict =
  "ok" | "bad-signature" | "unknown-key" | "unsupported-scheme" | "malformed-signature";

/** The exact bytes npm signs. */
export function signedPayload(name: string, version: string, integrity: string): string {
  return `${name}@${version}:${integrity}`;
}

export function parseKeys(raw: unknown, source: string): RegistryKey[] {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${source} must be a JSON object`);
  }
  const { keys } = raw as Record<string, unknown>;
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error(`${source}: "keys" must be a non-empty array`);
  }
  return keys.map((entry, index) => {
    const where = `${source}: keys[${index}]`;
    if (typeof entry !== "object" || entry === null) throw new Error(`${where} must be an object`);
    const { keyid, keytype, scheme, key, expires } = entry as Record<string, unknown>;
    for (const [field, value] of Object.entries({ keyid, keytype, scheme, key })) {
      if (typeof value !== "string" || value === "") {
        throw new Error(`${where}: "${field}" must be a non-empty string`);
      }
    }
    if (expires !== null && expires !== undefined && typeof expires !== "string") {
      throw new Error(`${where}: "expires" must be a string or null`);
    }
    return {
      keyid: keyid as string,
      keytype: keytype as string,
      scheme: scheme as string,
      key: key as string,
      expires: typeof expires === "string" ? expires : null,
    };
  });
}

export function keysById(keys: readonly RegistryKey[]): Map<string, RegistryKey> {
  return new Map(keys.map((key) => [key.keyid, key]));
}

/**
 * Whether the registry has retired this key.
 *
 * Informational, never disqualifying — see {@link verifySignature}.
 */
export function isRetired(key: RegistryKey, now: Date): boolean {
  if (key.expires === null) return false;
  const expiry = Date.parse(key.expires);
  return Number.isNaN(expiry) || expiry <= now.getTime();
}

function toPem(base64Spki: string): string {
  const lines = base64Spki.match(/.{1,64}/g) ?? [base64Spki];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

/**
 * Verify one signature over one package.
 *
 * **A retired key still verifies.** This is the one judgement call in the
 * module and it goes the other way from the obvious reading, so: npm rotated
 * its signing key on 2025-01-29 and still serves the old one from
 * `/-/npm/v1/keys`. It does that deliberately. Versions published before the
 * rotation are signed under the old key and are never re-signed — npm does not
 * retroactively re-sign history — so 159 of the 482 packages in this tree
 * carry an old-key signature and always will. Rejecting a retired key would
 * fail a third of any real dependency tree, permanently, and the only
 * available fix would be to turn the check off.
 *
 * It would also buy nothing. The guarantee here is cryptographic: a forged
 * tarball cannot produce a signature that verifies under the retired key
 * either, because that key's private half is no more available to an attacker
 * than the current one's. Expiry says "stop signing new things with this",
 * which is a statement about npm's own publishing pipeline, not about whether
 * a signature made under it is sound. The registry deleting the key — rather
 * than expiring it — is what would mean "no longer trust these", and that
 * case is already covered: the key would be `unknown-key`.
 *
 * So expiry is recorded and reported ({@link SignatureCheck.viaRetiredKey})
 * rather than enforced. What is enforced is that a signature exists, is made
 * under a key the registry still publishes, and verifies over the integrity
 * this repository has committed.
 */
export function verifySignature(
  pkg: { name: string; version: string; integrity: string },
  signature: PackageSignature,
  keys: ReadonlyMap<string, RegistryKey>,
): SignatureVerdict {
  const key = keys.get(signature.keyid);
  if (key === undefined) return "unknown-key";
  if (key.scheme !== SUPPORTED_SCHEME || key.keytype !== SUPPORTED_SCHEME) {
    return "unsupported-scheme";
  }

  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(signature.sig, "base64");
    if (signatureBytes.byteLength === 0) return "malformed-signature";
  } catch {
    return "malformed-signature";
  }

  try {
    const verifier = createVerify("sha256");
    verifier.update(signedPayload(pkg.name, pkg.version, pkg.integrity));
    verifier.end();
    return verifier.verify(toPem(key.key), signatureBytes) ? "ok" : "bad-signature";
  } catch {
    // A DER body that is not a well-formed ECDSA signature makes OpenSSL throw
    // rather than return false. Either way the signature does not verify.
    return "malformed-signature";
  }
}

export interface SignatureCheck {
  verdict: SignatureVerdict | "no-signature";
  /** Every verdict seen, so the report can say why a package has no good one. */
  attempts: readonly SignatureVerdict[];
  /** True when every signature that verified was made under a retired key. */
  viaRetiredKey: boolean;
}

/**
 * A package passes on **one** good signature.
 *
 * Packages carry two signatures during a key rotation (45 of the 482 in this
 * tree do). Requiring all of them to verify would fail the moment the registry
 * adds a signature under a key this build has not fetched yet.
 */
export function checkSignatures(
  pkg: { name: string; version: string; integrity: string },
  signatures: readonly PackageSignature[],
  keys: ReadonlyMap<string, RegistryKey>,
  now: Date,
): SignatureCheck {
  if (signatures.length === 0) {
    return { verdict: "no-signature", attempts: [], viaRetiredKey: false };
  }
  const attempts = signatures.map((signature) => verifySignature(pkg, signature, keys));
  const verified = signatures.filter((_, index) => attempts[index] === "ok");
  const current = verified.filter((signature) => {
    const key = keys.get(signature.keyid);
    return key !== undefined && !isRetired(key, now);
  });
  return {
    verdict: attempts.find((v) => v === "ok") ?? attempts[0] ?? "no-signature",
    attempts,
    viaRetiredKey: verified.length > 0 && current.length === 0,
  };
}
