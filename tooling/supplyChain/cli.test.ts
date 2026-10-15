// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { main, parseArgs, DEFAULT_CONCURRENCY } from "./cli.ts";
import { parsePolicy } from "./evaluate.ts";
import { signedPayload } from "./signature.ts";
import type { FetchLike } from "./registry.ts";

describe("parseArgs", () => {
  it("defaults to the committed lockfile and policy", () => {
    expect(parseArgs([])).toEqual({
      lockfile: "pnpm-lock.yaml",
      policy: "supply-chain-policy.json",
      update: false,
      concurrency: DEFAULT_CONCURRENCY,
      summary: null,
      skipAudit: false,
    });
  });

  it("reads every flag", () => {
    expect(
      parseArgs([
        "--lockfile",
        "other.yaml",
        "--policy",
        "other.json",
        "--summary",
        "sum.md",
        "--concurrency",
        "4",
        "--update",
        "--skip-audit",
      ]),
    ).toEqual({
      lockfile: "other.yaml",
      policy: "other.json",
      update: true,
      concurrency: 4,
      summary: "sum.md",
      skipAudit: true,
    });
  });

  it("rejects a flag with no value and an unknown flag", () => {
    expect(() => parseArgs(["--policy"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--audit-level", "high"])).toThrow(/Unknown argument/);
  });

  it("rejects a concurrency that is not a positive integer", () => {
    for (const value of ["0", "-2", "1.5", "all"]) {
      expect(() => parseArgs(["--concurrency", value])).toThrow(/positive integer/);
    }
  });
});

/**
 * An end-to-end run against a registry held in this process.
 *
 * The private key lives here, so the fixture can sign the true statement about
 * a package and — in the tampering tests — decline to. That is the only way to
 * exercise the failure the gate exists for: npm will not sign a forged
 * integrity on request.
 */
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const KEY_ID = "SHA256:test";

function sign(payload: string): string {
  const signer = createSign("sha256");
  signer.update(payload);
  signer.end();
  return signer.sign(privateKey).toString("base64");
}

const KEYS_BODY = {
  keys: [
    {
      keyid: KEY_ID,
      keytype: "ecdsa-sha2-nistp256",
      scheme: "ecdsa-sha2-nistp256",
      key: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
      expires: null,
    },
  ],
};

interface RegistryPackage {
  integrity: string;
  provenance?: string;
  signOver?: string;
}

const REGISTRY: Record<string, RegistryPackage> = {
  "react/19.2.7": { integrity: "sha512-react==", provenance: "https://slsa.dev/provenance/v1" },
  "zod/4.1.13": { integrity: "sha512-zod==" },
};

function stubFetch(registry: Record<string, RegistryPackage> = REGISTRY): FetchLike {
  return (url) => {
    const after = url.replace("https://registry.test/", "");
    if (after === "-/npm/v1/keys") {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(KEYS_BODY) });
    }
    const entry = registry[after];
    if (entry === undefined) {
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.reject(new Error("not found")),
      });
    }
    const [name, version] = [
      after.slice(0, after.lastIndexOf("/")),
      after.slice(after.lastIndexOf("/") + 1),
    ];
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          dist: {
            integrity: entry.integrity,
            signatures: [
              {
                keyid: KEY_ID,
                sig: sign(entry.signOver ?? signedPayload(name, version, entry.integrity)),
              },
            ],
            ...(entry.provenance === undefined
              ? {}
              : { attestations: { provenance: { predicateType: entry.provenance } } }),
          },
        }),
    });
  };
}

const LOCKFILE = `lockfileVersion: "9.0"

importers:
  .:
    dependencies:
      react:
        specifier: ^19.0.0
        version: 19.2.7
      zod:
        specifier: ^4.0.0
        version: 4.1.13

packages:
  react@19.2.7:
    resolution: { integrity: sha512-react== }
  zod@4.1.13:
    resolution: { integrity: sha512-zod== }
`;

const POLICY = {
  registry: "https://registry.test",
  audit: { failOn: "moderate" as const, allow: [] },
  provenance: { attested: ["react"] },
};

const CLEAN_AUDIT = JSON.stringify({
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } },
  advisories: {},
});

const dir = mkdtempSync(path.join(tmpdir(), "supply-chain-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

let logged: string[];
let errored: string[];

interface RunOptions {
  argv?: string[];
  policy?: unknown;
  lockfile?: string;
  registry?: Record<string, RegistryPackage>;
  audit?: string | (() => Promise<string>);
}

async function run(options: RunOptions = {}): Promise<number> {
  const policyPath = path.join(dir, "policy.json");
  const lockPath = path.join(dir, "lock.yaml");
  writeFileSync(policyPath, `${JSON.stringify(options.policy ?? POLICY, null, 2)}\n`);
  writeFileSync(lockPath, options.lockfile ?? LOCKFILE);
  const audit = options.audit ?? CLEAN_AUDIT;
  return main(["--lockfile", lockPath, "--policy", policyPath, ...(options.argv ?? [])], {
    io: {
      log: (line) => logged.push(line),
      error: (line) => errored.push(line),
    },
    fetch: stubFetch(options.registry),
    now: new Date("2026-10-15T12:00:00Z"),
    audit: typeof audit === "function" ? audit : () => Promise.resolve(audit),
    cwd: dir,
  });
}

beforeEach(() => {
  logged = [];
  errored = [];
});

describe("main", () => {
  it("exits 0 on a tree that verifies", async () => {
    expect(await run()).toBe(0);
    expect(logged.join("\n")).toContain("2/2 packages verified");
    expect(logged.join("\n")).toContain("No supply-chain findings.");
  });

  it("exits 1 when the lockfile integrity is not what the registry signed", async () => {
    const tampered = LOCKFILE.replace("sha512-react==", "sha512-TAMPERED==");
    expect(await run({ lockfile: tampered })).toBe(1);
    expect(logged.join("\n")).toContain("integrity-mismatch");
  });

  it("exits 1 when a signature does not verify", async () => {
    // The registry signs a statement about a different version than the one
    // the lockfile pins — a genuine signature over the wrong thing.
    const registry: Record<string, RegistryPackage> = {
      ...REGISTRY,
      "react/19.2.7": {
        integrity: "sha512-react==",
        signOver: signedPayload("react", "19.0.0", "sha512-react=="),
      },
    };
    expect(await run({ registry })).toBe(1);
    expect(logged.join("\n")).toContain("bad-signature");
  });

  it("exits 1 on an advisory at the floor", async () => {
    const audit = JSON.stringify({
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 0, critical: 0 } },
      advisories: {
        "1": {
          github_advisory_id: "GHSA-aaaa-bbbb-cccc",
          module_name: "zod",
          severity: "moderate",
          title: "something",
          url: "https://example.test",
          vulnerable_versions: "<4.2.0",
          patched_versions: ">=4.2.0",
          findings: [{ version: "4.1.13", paths: [".>zod"] }],
        },
      },
    });
    expect(await run({ audit })).toBe(1);
    expect(logged.join("\n")).toContain("GHSA-aaaa-bbbb-cccc");
  });

  it("exits 2 when the audit cannot run, rather than reporting a clean tree", async () => {
    /*
      The failure mode this gate is most likely to hit in practice and the one
      it must not get wrong. An audit that could not reach the registry has
      found nothing, and "found nothing" and "there is nothing" are the same
      output from anything that only counts advisories.
    */
    expect(await run({ audit: "<html>407 Proxy Authentication Required</html>" })).toBe(2);
    expect(errored.join("\n")).toContain("did not produce JSON");
  });

  it("exits 2 when the registry is unreachable", async () => {
    const unreachable: FetchLike = () => Promise.reject(new Error("ENOTFOUND"));
    const policyPath = path.join(dir, "policy.json");
    const lockPath = path.join(dir, "lock.yaml");
    writeFileSync(policyPath, `${JSON.stringify(POLICY, null, 2)}\n`);
    writeFileSync(lockPath, LOCKFILE);
    const code = await main(["--lockfile", lockPath, "--policy", policyPath], {
      io: { log: (l) => logged.push(l), error: (l) => errored.push(l) },
      fetch: unreachable,
      now: new Date("2026-10-15T12:00:00Z"),
      audit: () => Promise.resolve(CLEAN_AUDIT),
      cwd: dir,
    });
    expect(code).toBe(2);
    expect(errored.join("\n")).toContain("ENOTFOUND");
  });

  it("exits 1 when a package has lost its provenance", async () => {
    const registry: Record<string, RegistryPackage> = {
      ...REGISTRY,
      "react/19.2.7": { integrity: "sha512-react==" },
    };
    expect(await run({ registry })).toBe(1);
    expect(logged.join("\n")).toContain("provenance-lost");
  });

  it("exits 2 on an unreadable policy", async () => {
    expect(await run({ policy: { registry: "https://registry.test" } })).toBe(2);
    expect(errored.join("\n")).toContain('"audit" must be an object');
  });

  it("skips the audit when asked, and does not call it", async () => {
    let called = false;
    const code = await run({
      argv: ["--skip-audit"],
      audit: () => {
        called = true;
        return Promise.resolve(CLEAN_AUDIT);
      },
    });
    expect(code).toBe(0);
    expect(called).toBe(false);
  });

  it("appends a Markdown summary when given a file", async () => {
    const summary = path.join(dir, "summary.md");
    writeFileSync(summary, "# Build\n");
    expect(await run({ argv: ["--summary", summary] })).toBe(0);
    const contents = readFileSync(summary, "utf8");
    // Appended, not overwritten: the other gates write to the same file.
    expect(contents.startsWith("# Build\n")).toBe(true);
    expect(contents).toContain("## Supply chain");
  });

  it("writes the observed baseline under --update and reports the delta", async () => {
    const policyPath = path.join(dir, "policy.json");
    expect(
      await run({ argv: ["--update"], policy: { ...POLICY, provenance: { attested: [] } } }),
    ).toBe(0);
    const written = parsePolicy(readFileSync(policyPath, "utf8"), policyPath);
    expect(written.provenance.attested).toEqual(["react"]);
    expect(logged.join("\n")).toContain("1 package(s) with provenance (+1, -0)");
  });

  it("names what --update is about to stop claiming", async () => {
    // A removal is the interesting half of the diff, so it is called out by
    // name rather than left as a count.
    expect(
      await run({
        argv: ["--update"],
        policy: { ...POLICY, provenance: { attested: ["react", "gone"] } },
      }),
    ).toBe(0);
    expect(logged.join("\n")).toContain("no longer attested: gone");
  });

  it("exits 2 on an unknown argument without reading anything", async () => {
    expect(await run({ argv: ["--yolo"] })).toBe(2);
    expect(errored.join("\n")).toContain("Unknown argument");
  });
});
