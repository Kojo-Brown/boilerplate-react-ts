// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isSeverity, parseAuditReport, severityRank, SEVERITY_ORDER } from "./audit.ts";

const report = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    metadata: { vulnerabilities: { info: 0, low: 1, moderate: 0, high: 1, critical: 0 } },
    advisories: {
      "1130588": {
        id: 1130588,
        github_advisory_id: "GHSA-mh99-v99m-4gvg",
        module_name: "brace-expansion",
        severity: "high",
        title: "brace-expansion: DoS via unbounded expansion",
        url: "https://github.com/advisories/GHSA-mh99-v99m-4gvg",
        vulnerable_versions: "<1.1.17",
        patched_versions: ">=1.1.17",
        findings: [{ version: "1.1.16", paths: [".>eslint>minimatch>brace-expansion"] }],
      },
      "1234567": {
        id: 1234567,
        github_advisory_id: "GHSA-aaaa-bbbb-cccc",
        module_name: "undici",
        severity: "low",
        title: "undici: response truncation",
        url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
        vulnerable_versions: "<8.10.2",
        patched_versions: ">=8.10.2",
        findings: [{ version: "8.9.0", paths: [".>jsdom>undici"] }],
      },
    },
    ...overrides,
  });

describe("severity helpers", () => {
  it("orders severities the way the advisory database does", () => {
    expect([...SEVERITY_ORDER]).toEqual(["info", "low", "moderate", "high", "critical"]);
    expect(severityRank("critical")).toBeGreaterThan(severityRank("high"));
    expect(severityRank("moderate")).toBeGreaterThan(severityRank("low"));
  });

  it("recognises only the five real severities", () => {
    expect(isSeverity("moderate")).toBe(true);
    expect(isSeverity("severe")).toBe(false);
    expect(isSeverity(undefined)).toBe(false);
  });
});

describe("parseAuditReport", () => {
  it("reads every advisory with its module, severity and installed versions", () => {
    const { advisories, counts } = parseAuditReport(report(), "audit");
    expect(counts).toEqual({ info: 0, low: 1, moderate: 0, high: 1, critical: 0 });
    expect(advisories).toHaveLength(2);
    expect(advisories[0]).toMatchObject({
      ghsa: "GHSA-mh99-v99m-4gvg",
      module: "brace-expansion",
      severity: "high",
      versions: ["1.1.16"],
      paths: [".>eslint>minimatch>brace-expansion"],
      patchedVersions: ">=1.1.17",
    });
  });

  it("sorts the most severe first", () => {
    const { advisories } = parseAuditReport(report(), "audit");
    expect(advisories.map((a) => a.severity)).toEqual(["high", "low"]);
  });

  it("keys on the GHSA id rather than the numeric one", () => {
    /*
      The numeric id is not stable within a single report: pnpm gives
      GHSA-mh99-v99m-4gvg the id 1130734 under `actions` and 1130588 under
      `advisories`. An allowlist keyed on the number would match today and
      silently stop matching after any advisory-database reshuffle — which
      fails open, since a suppression that stops matching turns into
      `allow-unused` while the advisory it covered reappears.
    */
    const { advisories } = parseAuditReport(report(), "audit");
    expect(advisories.map((a) => a.ghsa)).toEqual(["GHSA-mh99-v99m-4gvg", "GHSA-aaaa-bbbb-cccc"]);
  });

  it("falls back to the report key when a registry serves no GHSA id", () => {
    const body = JSON.parse(report()) as Record<string, unknown>;
    const advisories = body.advisories as Record<string, Record<string, unknown>>;
    delete advisories["1130588"]?.github_advisory_id;
    const parsed = parseAuditReport(JSON.stringify(body), "audit");
    expect(parsed.advisories.map((a) => a.ghsa)).toContain("1130588");
  });

  it("accepts a clean report", () => {
    const clean = JSON.stringify({
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } },
      advisories: {},
    });
    expect(parseAuditReport(clean, "audit")).toEqual({
      advisories: [],
      counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
    });
  });

  it("refuses output that is not JSON", () => {
    // Offline, or behind a proxy serving an error page. The one unacceptable
    // reading of an HTML error page is "no advisories found".
    expect(() => parseAuditReport("<html>407 Proxy Authentication</html>", "audit")).toThrow(
      /did not produce JSON/,
    );
    expect(() => parseAuditReport("", "audit")).toThrow(/did not produce JSON/);
  });

  it("refuses a JSON document with no metadata block", () => {
    /*
      This is the load-bearing guard. `{"advisories":{}}` and a real clean
      report are indistinguishable by their advisory list alone, and only one
      of them means the audit ran. Every report pnpm produces — including an
      empty one — carries `metadata.vulnerabilities`, so its absence is
      evidence the command did not do its job.
    */
    expect(() => parseAuditReport(JSON.stringify({ advisories: {} }), "audit")).toThrow(
      /no "metadata" block/,
    );
    expect(() => parseAuditReport(JSON.stringify({ metadata: {} }), "audit")).toThrow(
      /"metadata.vulnerabilities" is missing/,
    );
  });

  it("refuses an advisory whose severity it does not recognise", () => {
    const body = JSON.parse(report()) as Record<string, unknown>;
    const advisories = body.advisories as Record<string, Record<string, unknown>>;
    const entry = advisories["1130588"];
    if (entry) entry.severity = "spicy";
    // Defaulting an unknown severity to something would either hide a
    // critical or cry wolf about an informational note.
    expect(() => parseAuditReport(JSON.stringify(body), "audit")).toThrow(/severity "spicy"/);
  });

  it("deduplicates versions and paths across findings", () => {
    const body = JSON.parse(report()) as Record<string, unknown>;
    const advisories = body.advisories as Record<string, Record<string, unknown>>;
    const entry = advisories["1130588"];
    if (entry) {
      entry.findings = [
        { version: "1.1.16", paths: [".>a>brace-expansion", ".>b>brace-expansion"] },
        { version: "1.1.16", paths: [".>a>brace-expansion"] },
      ];
    }
    const parsed = parseAuditReport(JSON.stringify(body), "audit");
    expect(parsed.advisories[0]?.versions).toEqual(["1.1.16"]);
    expect(parsed.advisories[0]?.paths).toEqual([".>a>brace-expansion", ".>b>brace-expansion"]);
  });
});
