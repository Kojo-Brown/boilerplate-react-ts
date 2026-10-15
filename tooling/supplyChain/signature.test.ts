// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createSign, generateKeyPairSync } from "node:crypto";
import {
  checkSignatures,
  isRetired,
  keysById,
  parseKeys,
  signedPayload,
  verifySignature,
  type RegistryKey,
} from "./signature.ts";

/**
 * A local keypair standing in for npm's.
 *
 * The real registry will not sign a forged integrity on request, so the only
 * way to test that a tampered hash is rejected is to hold the private half
 * here and sign both the true and the false statement with it.
 */
function makeKey(keyid: string, expires: string | null) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const sign = (payload: string): string => {
    const signer = createSign("sha256");
    signer.update(payload);
    signer.end();
    return signer.sign(privateKey).toString("base64");
  };
  const registryKey: RegistryKey = {
    keyid,
    keytype: "ecdsa-sha2-nistp256",
    scheme: "ecdsa-sha2-nistp256",
    key: spki,
    expires,
  };
  return { registryKey, sign };
}

const PKG = { name: "react", version: "19.2.7", integrity: "sha512-abc==" };
const NOW = new Date("2026-10-15T00:00:00Z");

const current = makeKey("SHA256:current", null);
const retired = makeKey("SHA256:retired", "2025-01-29T00:00:00.000Z");
const keys = keysById([current.registryKey, retired.registryKey]);

describe("signedPayload", () => {
  it("is name@version:integrity, which is what npm signs", () => {
    // Pinned exactly: a payload that drifts by one character verifies nothing
    // and would make every package in the tree report `bad-signature`.
    expect(signedPayload("react", "19.2.7", "sha512-abc==")).toBe("react@19.2.7:sha512-abc==");
    expect(signedPayload("@types/react", "19.2.17", "sha512-x")).toBe(
      "@types/react@19.2.17:sha512-x",
    );
  });
});

describe("verifySignature", () => {
  it("accepts a signature over the matching name, version and integrity", () => {
    const sig = {
      keyid: "SHA256:current",
      sig: current.sign(signedPayload(PKG.name, PKG.version, PKG.integrity)),
    };
    expect(verifySignature(PKG, sig, keys)).toBe("ok");
  });

  it("rejects a signature made over a different integrity", () => {
    // This is the check's whole purpose: the signature is genuine, made with
    // the real key, and says something about a *different* tarball than the
    // one the lockfile pins.
    const signedOverOther = current.sign(signedPayload("react", "19.2.7", "sha512-SOMETHINGELSE="));
    expect(verifySignature(PKG, { keyid: "SHA256:current", sig: signedOverOther }, keys)).toBe(
      "bad-signature",
    );
  });

  it("rejects a signature made over a different version of the same package", () => {
    const signedOverOtherVersion = current.sign(signedPayload("react", "19.2.6", PKG.integrity));
    expect(
      verifySignature(PKG, { keyid: "SHA256:current", sig: signedOverOtherVersion }, keys),
    ).toBe("bad-signature");
  });

  it("rejects a key the registry does not publish", () => {
    const stranger = makeKey("SHA256:stranger", null);
    const sig = {
      keyid: "SHA256:stranger",
      sig: stranger.sign(signedPayload(PKG.name, PKG.version, PKG.integrity)),
    };
    expect(verifySignature(PKG, sig, keys)).toBe("unknown-key");
  });

  it("accepts a signature under a key the registry has retired", () => {
    /*
      The judgement call, pinned. npm rotated its signing key on 2025-01-29 and
      keeps serving the old one; versions published before then are signed with
      it and are never re-signed. Rejecting it would fail a third of a real
      tree forever while proving nothing — an attacker has no more access to
      the retired key's private half than to the current one's.
    */
    const sig = {
      keyid: "SHA256:retired",
      sig: retired.sign(signedPayload(PKG.name, PKG.version, PKG.integrity)),
    };
    expect(verifySignature(PKG, sig, keys)).toBe("ok");
  });

  it("rejects a key whose scheme it cannot verify", () => {
    const rsa: RegistryKey = {
      ...current.registryKey,
      keyid: "SHA256:rsa",
      scheme: "rsa-sha2-512",
      keytype: "rsa-sha2-512",
    };
    const sig = { keyid: "SHA256:rsa", sig: current.sign("whatever") };
    expect(verifySignature(PKG, sig, keysById([rsa]))).toBe("unsupported-scheme");
  });

  it("refuses a signature that is not a signature instead of throwing", () => {
    // Two paths to the same refusal, and which one a given body takes is
    // OpenSSL's business rather than something worth pinning: a body that is
    // not valid DER comes back as `false` here, while some malformed bodies
    // make it throw. What matters is that neither escapes as an exception —
    // one bad entry must not abort a run over 482 packages — and that neither
    // is ever `ok`.
    const notDer = verifySignature(PKG, { keyid: "SHA256:current", sig: "bm90LWRlcg==" }, keys);
    expect(notDer).toBe("bad-signature");
    expect(verifySignature(PKG, { keyid: "SHA256:current", sig: "" }, keys)).toBe(
      "malformed-signature",
    );
  });
});

describe("isRetired", () => {
  it("is false for a key with no expiry and true once the expiry has passed", () => {
    expect(isRetired(current.registryKey, NOW)).toBe(false);
    expect(isRetired(retired.registryKey, NOW)).toBe(true);
  });

  it("treats an unreadable expiry as retired", () => {
    // Reporting a field we could not parse as "fine" is how a key rotation
    // nobody understood becomes a silent pass.
    expect(isRetired({ ...current.registryKey, expires: "soon" }, NOW)).toBe(true);
  });
});

describe("checkSignatures", () => {
  const good = (key: typeof current) => ({
    keyid: key.registryKey.keyid,
    sig: key.sign(signedPayload(PKG.name, PKG.version, PKG.integrity)),
  });

  it("reports a package the registry never signed", () => {
    expect(checkSignatures(PKG, [], keys, NOW)).toEqual({
      verdict: "no-signature",
      attempts: [],
      viaRetiredKey: false,
    });
  });

  it("passes on one good signature even when another is unusable", () => {
    // Packages carry two signatures through a key rotation. Requiring every
    // one to verify would fail the moment the registry adds a signature under
    // a key this run has not fetched.
    const check = checkSignatures(
      PKG,
      [{ keyid: "SHA256:unknown", sig: "AAAA" }, good(current)],
      keys,
      NOW,
    );
    expect(check.verdict).toBe("ok");
    expect(check.viaRetiredKey).toBe(false);
  });

  it("flags a package whose only valid signature is under the retired key", () => {
    const check = checkSignatures(PKG, [good(retired)], keys, NOW);
    expect(check).toMatchObject({ verdict: "ok", viaRetiredKey: true });
  });

  it("does not flag a retired key when a current one also signed", () => {
    const check = checkSignatures(PKG, [good(retired), good(current)], keys, NOW);
    expect(check).toMatchObject({ verdict: "ok", viaRetiredKey: false });
  });

  it("keeps every verdict so the report can say what went wrong", () => {
    const check = checkSignatures(PKG, [{ keyid: "SHA256:unknown", sig: "AA" }], keys, NOW);
    expect(check).toMatchObject({ verdict: "unknown-key", attempts: ["unknown-key"] });
  });
});

describe("parseKeys", () => {
  const valid = { keys: [{ keyid: "k", keytype: "t", scheme: "s", key: "AAA", expires: null }] };

  it("reads the registry's key document", () => {
    expect(parseKeys(valid, "keys")).toEqual([
      { keyid: "k", keytype: "t", scheme: "s", key: "AAA", expires: null },
    ]);
  });

  it("treats a missing expires as no expiry", () => {
    const [key] = parseKeys(
      { keys: [{ keyid: "k", keytype: "t", scheme: "s", key: "AAA" }] },
      "keys",
    );
    expect(key?.expires).toBeNull();
  });

  it("refuses a key document with no keys", () => {
    // An empty key set makes every signature `unknown-key`, which reads as 482
    // compromised packages rather than as the failed fetch it is.
    expect(() => parseKeys({ keys: [] }, "keys")).toThrow(/non-empty array/);
    expect(() => parseKeys({}, "keys")).toThrow(/non-empty array/);
    expect(() => parseKeys("not json", "keys")).toThrow(/must be a JSON object/);
  });

  it("refuses a key entry with a missing field", () => {
    expect(() => parseKeys({ keys: [{ keyid: "k", keytype: "t", scheme: "s" }] }, "keys")).toThrow(
      /"key" must be a non-empty string/,
    );
  });
});
