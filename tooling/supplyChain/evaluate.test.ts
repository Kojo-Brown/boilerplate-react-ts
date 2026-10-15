// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { Advisory } from "./audit.ts";
import {
  evaluate,
  formatPolicy,
  isAllowLive,
  parsePolicy,
  ratchet,
  type PackageVerification,
  type Policy,
} from "./evaluate.ts";
import type { LockedPackage } from "./lockfile.ts";

const NOW = new Date("2026-10-15T12:00:00Z");

const policy = (overrides: Partial<Policy> = {}): Policy => ({
  registry: "https://registry.npmjs.org",
  audit: { failOn: "moderate", allow: [] },
  provenance: { attested: [] },
  ...overrides,
});

const locked = (overrides: Partial<LockedPackage> = {}): LockedPackage => ({
  name: "react",
  version: "19.2.7",
  integrity: "sha512-abc==",
  kind: "registry",
  location: null,
  production: true,
  development: false,
  ...overrides,
});

const verified = (overrides: Partial<PackageVerification> = {}): PackageVerification => ({
  pkg: locked(),
  metadata: { integrity: "sha512-abc==", signatures: [{ keyid: "k", sig: "s" }], provenance: null },
  signatures: { verdict: "ok", attempts: ["ok"], viaRetiredKey: false },
  ...overrides,
});

const advisory = (overrides: Partial<Advisory> = {}): Advisory => ({
  ghsa: "GHSA-aaaa-bbbb-cccc",
  module: "left-pad",
  severity: "high",
  title: "something bad",
  url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
  vulnerableVersions: "<2.0.0",
  patchedVersions: ">=2.0.0",
  versions: ["1.0.0"],
  paths: [".>left-pad"],
  ...overrides,
});

const statusesOf = (v: ReturnType<typeof evaluate>, area: string) =>
  v.findings.filter((f) => f.area === area).map((f) => f.status);

describe("parsePolicy", () => {
  const valid = JSON.stringify(policy());

  it("reads the three decisions", () => {
    expect(parsePolicy(valid, "policy")).toEqual(policy());
  });

  it("refuses a plain-http registry", () => {
    // Every guarantee below the registry read is a statement fetched over that
    // connection; an attacker who can rewrite it can mint her own signatures.
    const http = JSON.stringify(policy({ registry: "http://registry.npmjs.org" }));
    expect(() => parsePolicy(http, "policy")).toThrow(/must be an https URL/);
  });

  it("refuses a severity floor that is not a severity", () => {
    const bad = JSON.stringify({ ...policy(), audit: { failOn: "scary", allow: [] } });
    expect(() => parsePolicy(bad, "policy")).toThrow(/"audit.failOn" must be one of/);
  });

  it("requires a suppression to carry a real reason", () => {
    /*
      20 characters is arbitrary and the point is not the number: a field that
      accepts "wontfix" is a field that gets "wontfix", and a suppression
      nobody had to justify is one nobody revisits. The reviewer of the diff
      that adds the entry is the only control here, and this is what gives
      them something to review.
    */
    const terse = JSON.stringify({
      ...policy(),
      audit: {
        failOn: "moderate",
        allow: [{ advisory: "GHSA-x", reason: "later", expires: "2027-01-01" }],
      },
    });
    expect(() => parsePolicy(terse, "policy")).toThrow(/at least 20 characters/);
  });

  it("requires a suppression to carry a real expiry date", () => {
    const build = (expires: unknown) =>
      JSON.stringify({
        ...policy(),
        audit: {
          failOn: "moderate",
          allow: [{ advisory: "GHSA-x", reason: "a reason of sufficient length", expires }],
        },
      });
    expect(() => parsePolicy(build(undefined), "policy")).toThrow(/YYYY-MM-DD/);
    expect(() => parsePolicy(build("soon"), "policy")).toThrow(/YYYY-MM-DD/);
    expect(() => parsePolicy(build("2027-13-45"), "policy")).toThrow(/not a real date/);
  });

  it("refuses a duplicated baseline entry", () => {
    const dup = JSON.stringify({ ...policy(), provenance: { attested: ["react", "react"] } });
    expect(() => parsePolicy(dup, "policy")).toThrow(/lists react twice/);
  });

  it("refuses a missing or mistyped block rather than defaulting it", () => {
    // A missing `audit` read as `{}` would leave `failOn` undefined and
    // suppress nothing and fail nothing — the gate on, reporting green.
    expect(() => parsePolicy(JSON.stringify({ registry: "https://r.test" }), "policy")).toThrow(
      /"audit" must be an object/,
    );
    expect(() =>
      parsePolicy(JSON.stringify({ ...policy(), provenance: ["react"] }), "policy"),
    ).toThrow(/"provenance" must be an object/);
    expect(() => parsePolicy("[]", "policy")).toThrow(/must contain a JSON object/);
    expect(() => parsePolicy("{", "policy")).toThrow(/not valid JSON/);
  });

  it("round-trips through formatPolicy", () => {
    const written = formatPolicy(policy({ provenance: { attested: ["zod", "react"] } }));
    expect(written.endsWith("\n")).toBe(true);
    expect(parsePolicy(written, "policy").provenance.attested).toEqual(["react", "zod"]);
  });
});

describe("isAllowLive", () => {
  const entry = {
    advisory: "GHSA-x",
    reason: "a reason of sufficient length",
    expires: "2026-10-15",
  };

  it("lasts to the end of the expiry day, UTC", () => {
    // A date is a day, not a moment. Expiring at midnight would retire a
    // suppression on the morning of the day it says it is good through.
    expect(isAllowLive(entry, new Date("2026-10-15T23:59:00Z"))).toBe(true);
    expect(isAllowLive(entry, new Date("2026-10-16T00:00:01Z"))).toBe(false);
  });
});

describe("registry findings", () => {
  it("passes a package whose committed integrity matches a valid signature", () => {
    const verdict = evaluate([verified()], [], policy(), NOW);
    expect(statusesOf(verdict, "registry")).toEqual(["ok"]);
    expect(verdict).toMatchObject({ failed: false, verified: 1, checked: 1 });
  });

  it("fails a lockfile integrity the registry does not serve", () => {
    const verdict = evaluate(
      [
        verified({
          metadata: { integrity: "sha512-DIFFERENT==", signatures: [], provenance: null },
        }),
      ],
      [],
      policy(),
      NOW,
    );
    expect(statusesOf(verdict, "registry")).toEqual(["integrity-mismatch"]);
    expect(verdict.failed).toBe(true);
  });

  it("fails a dependency that bypasses the registry entirely", () => {
    // A git or file resolution is not a gap in coverage, it is the finding: it
    // has no publisher signature and no immutable version.
    const git = verified({
      pkg: locked({ kind: "git", location: "https://github.com/x/y.git", integrity: null }),
      metadata: null,
      signatures: null,
    });
    const verdict = evaluate([git], [], policy(), NOW);
    expect(statusesOf(verdict, "registry")).toEqual(["off-registry"]);
    expect(verdict.findings[0]?.detail).toContain("https://github.com/x/y.git");
  });

  it("fails a registry package with no integrity in the lockfile", () => {
    const verdict = evaluate(
      [verified({ pkg: locked({ integrity: null }), metadata: null, signatures: null })],
      [],
      policy(),
      NOW,
    );
    expect(statusesOf(verdict, "registry")).toEqual(["no-integrity"]);
  });

  it("fails every unusable signature verdict", () => {
    for (const verdict of ["bad-signature", "unknown-key", "no-signature"] as const) {
      const result = evaluate(
        [verified({ signatures: { verdict, attempts: [], viaRetiredKey: false } })],
        [],
        policy(),
        NOW,
      );
      expect(result.failed).toBe(true);
      expect(statusesOf(result, "registry")).toEqual([verdict]);
    }
  });

  it("passes a signature under the retired key and says so", () => {
    const result = evaluate(
      [verified({ signatures: { verdict: "ok", attempts: ["ok"], viaRetiredKey: true } })],
      [],
      policy(),
      NOW,
    );
    expect(statusesOf(result, "registry")).toEqual(["retired-key"]);
    expect(result).toMatchObject({ failed: false, verified: 1 });
  });
});

describe("advisory findings", () => {
  it("fails an advisory at or above the floor and reports one below it", () => {
    const verdict = evaluate(
      [verified()],
      [advisory({ severity: "moderate" }), advisory({ ghsa: "GHSA-low", severity: "low" })],
      policy(),
      NOW,
    );
    const findings = verdict.findings.filter((f) => f.area === "advisory");
    expect(findings.find((f) => f.subject === "GHSA-aaaa-bbbb-cccc")?.failed).toBe(true);
    // Below the floor it is still reported — a low-severity advisory is worth
    // knowing about, it is just not worth blocking a merge over.
    expect(findings.find((f) => f.subject === "GHSA-low")?.failed).toBe(false);
  });

  it("honours the floor the policy sets rather than a fixed one", () => {
    const strict = evaluate(
      [verified()],
      [advisory({ severity: "low" })],
      policy({ audit: { failOn: "low", allow: [] } }),
      NOW,
    );
    expect(strict.failed).toBe(true);
    const loose = evaluate(
      [verified()],
      [advisory({ severity: "high" })],
      policy({ audit: { failOn: "critical", allow: [] } }),
      NOW,
    );
    expect(loose.failed).toBe(false);
  });

  it("suppresses an advisory with a live allow entry", () => {
    const allowed = policy({
      audit: {
        failOn: "moderate",
        allow: [
          {
            advisory: "GHSA-aaaa-bbbb-cccc",
            reason: "dev-only, no reachable path from the application",
            expires: "2027-01-01",
          },
        ],
      },
    });
    const verdict = evaluate([verified()], [advisory()], allowed, NOW);
    expect(statusesOf(verdict, "advisory")).toEqual(["advisory-allowed"]);
    expect(verdict.failed).toBe(false);
    expect(verdict.findings.find((f) => f.area === "advisory")?.detail).toContain("2027-01-01");
  });

  it("stops suppressing once the entry has expired, and says both things", () => {
    const expired = policy({
      audit: {
        failOn: "moderate",
        allow: [
          {
            advisory: "GHSA-aaaa-bbbb-cccc",
            reason: "dev-only, no reachable path from the application",
            expires: "2026-01-01",
          },
        ],
      },
    });
    const verdict = evaluate([verified()], [advisory()], expired, NOW);
    // Both findings: the dead suppression, and the advisory it is no longer
    // covering. Reporting only the first would leave the reader thinking the
    // vulnerability had gone away.
    expect(statusesOf(verdict, "advisory")).toEqual(["allow-expired", "advisory"]);
    expect(verdict.failed).toBe(true);
  });

  it("fails a suppression that matches nothing", () => {
    const stale = policy({
      audit: {
        failOn: "moderate",
        allow: [
          {
            advisory: "GHSA-gone",
            reason: "accepted while we waited on a fix",
            expires: "2027-01-01",
          },
        ],
      },
    });
    const verdict = evaluate([verified()], [], stale, NOW);
    expect(statusesOf(verdict, "advisory")).toEqual(["allow-unused"]);
    expect(verdict.failed).toBe(true);
  });
});

describe("provenance findings", () => {
  const withProvenance = (name: string) =>
    verified({
      pkg: locked({ name }),
      metadata: {
        integrity: "sha512-abc==",
        signatures: [{ keyid: "k", sig: "s" }],
        provenance: "https://slsa.dev/provenance/v1",
      },
    });

  it("passes a recorded package that still publishes provenance", () => {
    const verdict = evaluate(
      [withProvenance("react")],
      [],
      policy({ provenance: { attested: ["react"] } }),
      NOW,
    );
    expect(statusesOf(verdict, "provenance")).toEqual(["ok"]);
    expect(verdict.failed).toBe(false);
  });

  it("fails a package that published provenance and has stopped", () => {
    // The regression the baseline exists for: a release pipeline that stopped
    // attesting is either compromised or has changed hands.
    const verdict = evaluate(
      [verified({ pkg: locked({ name: "react" }) })],
      [],
      policy({ provenance: { attested: ["react"] } }),
      NOW,
    );
    expect(statusesOf(verdict, "provenance")).toEqual(["provenance-lost"]);
    expect(verdict.failed).toBe(true);
  });

  it("fails a package with provenance that the baseline has not recorded", () => {
    const verdict = evaluate([withProvenance("zod")], [], policy(), NOW);
    expect(statusesOf(verdict, "provenance")).toEqual(["provenance-unrecorded"]);
  });

  it("fails a baseline entry for something no longer installed", () => {
    const verdict = evaluate([verified()], [], policy({ provenance: { attested: ["gone"] } }), NOW);
    expect(statusesOf(verdict, "provenance")).toEqual(["provenance-stale"]);
  });

  it("says nothing about a package that never had provenance", () => {
    // 57% of a real tree. Requiring provenance outright would mean deleting
    // most of the dependency list, so absence is simply not covered.
    const verdict = evaluate([verified()], [], policy(), NOW);
    expect(statusesOf(verdict, "provenance")).toEqual([]);
    expect(verdict.failed).toBe(false);
  });

  it("keys on the package name, so a version bump that drops provenance is caught", () => {
    const verdict = evaluate(
      [verified({ pkg: locked({ name: "react", version: "19.3.0" }) })],
      [],
      policy({ provenance: { attested: ["react"] } }),
      NOW,
    );
    expect(statusesOf(verdict, "provenance")).toEqual(["provenance-lost"]);
  });

  it("counts a name as attested when any installed copy of it has provenance", () => {
    // Two versions of one package in one tree is routine. Treating the copy
    // without provenance as a regression would report a loss that is not one.
    const verdict = evaluate(
      [withProvenance("react"), verified({ pkg: locked({ name: "react", version: "18.0.0" }) })],
      [],
      policy({ provenance: { attested: ["react"] } }),
      NOW,
    );
    expect(statusesOf(verdict, "provenance")).toEqual(["ok"]);
  });
});

describe("ratchet", () => {
  it("records every name with provenance, sorted", () => {
    const withProv = (name: string) =>
      verified({
        pkg: locked({ name }),
        metadata: {
          integrity: "sha512-abc==",
          signatures: [],
          provenance: "https://slsa.dev/provenance/v0.2",
        },
      });
    const updated = ratchet(
      [withProv("zod"), withProv("react"), verified({ pkg: locked({ name: "old" }) })],
      policy(),
      NOW,
    );
    expect(updated.provenance.attested).toEqual(["react", "zod"]);
  });

  it("drops expired suppressions rather than renewing them", () => {
    // Renewing a suppression is a decision with a reason attached, and that is
    // a human's to write. `--update` silently extending one would turn the
    // expiry into decoration.
    const before = policy({
      audit: {
        failOn: "moderate",
        allow: [
          {
            advisory: "GHSA-live",
            reason: "still waiting on the upstream fix",
            expires: "2027-01-01",
          },
          {
            advisory: "GHSA-dead",
            reason: "was waiting on the upstream fix",
            expires: "2026-01-01",
          },
        ],
      },
    });
    expect(ratchet([verified()], before, NOW).audit.allow.map((a) => a.advisory)).toEqual([
      "GHSA-live",
    ]);
  });

  it("leaves the registry and the severity floor alone", () => {
    const updated = ratchet([verified()], policy({ audit: { failOn: "high", allow: [] } }), NOW);
    expect(updated.audit.failOn).toBe("high");
    expect(updated.registry).toBe("https://registry.npmjs.org");
  });
});
