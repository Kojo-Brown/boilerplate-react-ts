// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { Finding, Verdict } from "./evaluate.ts";
import { formatMarkdown, formatText, retiredKeyCount } from "./report.ts";

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  area: "registry",
  subject: "react@19.2.7",
  status: "ok",
  detail: "integrity matches a valid registry signature",
  failed: false,
  ...overrides,
});

const verdict = (findings: Finding[]): Verdict => ({
  findings,
  verified: findings.filter((f) => f.area === "registry" && !f.failed).length,
  checked: findings.filter((f) => f.area === "registry").length,
  failed: findings.some((f) => f.failed),
});

describe("formatText", () => {
  it("leads with the count of packages verified", () => {
    // The sentence that says the gate ran. Its absence is the only way to
    // notice a gate that has quietly stopped checking anything.
    const text = formatText(verdict([finding(), finding({ subject: "zod@4.1.13" })]));
    expect(text.split("\n")[0]).toBe(
      "Supply chain: 2/2 packages verified against a registry signature.",
    );
  });

  it("says how many were verified under the retired key", () => {
    const text = formatText(verdict([finding(), finding({ status: "retired-key" })]));
    expect(text).toContain("2/2 packages verified against a registry signature, 1 of them under");
  });

  it("does not list passing packages", () => {
    // One line per verified package is 482 lines nobody reads, and a report
    // nobody reads is where a failure hides.
    const text = formatText(verdict(Array.from({ length: 50 }, () => finding())));
    expect(text).not.toContain("react@19.2.7");
    expect(text).toContain("No supply-chain findings.");
  });

  it("names each failure, its status and what to do about it", () => {
    const text = formatText(
      verdict([
        finding({
          status: "integrity-mismatch",
          detail: "the lockfile pins sha512-AAA… and the registry serves sha512-BBB…",
          failed: true,
        }),
      ]),
    );
    expect(text).toContain("FAIL  react@19.2.7  [integrity-mismatch]");
    expect(text).toContain("the lockfile pins sha512-AAA…");
    expect(text).toContain("→ the committed hash is not what the registry serves");
    expect(text).toContain("1 finding must be resolved.");
  });

  it("pluralises the closing count", () => {
    const two = formatText(
      verdict([
        finding({ status: "bad-signature", failed: true }),
        finding({ status: "no-signature", subject: "zod@4.1.13", failed: true }),
      ]),
    );
    expect(two).toContain("2 findings must be resolved.");
  });

  it("groups findings under the area they came from", () => {
    const text = formatText(
      verdict([
        finding({ status: "bad-signature", failed: true }),
        finding({ area: "advisory", subject: "GHSA-x", status: "advisory", failed: true }),
        finding({ area: "provenance", subject: "react", status: "provenance-lost", failed: true }),
      ]),
    );
    expect(text).toContain("Registry integrity & signatures:");
    expect(text).toContain("Advisories:");
    expect(text).toContain("Provenance baseline:");
  });

  it("reports an accepted advisory without failing", () => {
    // A suppression that is invisible is a suppression nobody revisits, so a
    // live one is printed on an otherwise green run.
    const text = formatText(
      verdict([
        finding({
          area: "advisory",
          subject: "GHSA-x",
          status: "advisory-allowed",
          detail: "moderate in left-pad <2.0.0, accepted until 2027-01-01: dev-only",
          failed: false,
        }),
      ]),
    );
    expect(text).toContain("accepted  GHSA-x");
    expect(text).toContain("No supply-chain findings.");
  });

  it("omits an area with nothing to say", () => {
    expect(formatText(verdict([finding()]))).not.toContain("Advisories:");
  });
});

describe("formatMarkdown", () => {
  it("opens with a verdict and the verified count", () => {
    const md = formatMarkdown(verdict([finding(), finding({ status: "retired-key" })]));
    expect(md).toContain("## Supply chain");
    expect(md).toContain("✅ No findings.");
    expect(md).toContain("`2` of `2` packages verified");
    expect(md).toContain("retired on 2025-01-29");
  });

  it("counts the packages publishing provenance", () => {
    const md = formatMarkdown(
      verdict([finding(), finding({ area: "provenance", subject: "react", status: "ok" })]),
    );
    expect(md).toContain("`1` package(s) publish SLSA provenance");
  });

  it("renders failures as a table with a remedy column", () => {
    const md = formatMarkdown(
      verdict([finding({ area: "advisory", subject: "GHSA-x", status: "advisory", failed: true })]),
    );
    expect(md).toContain("❌ 1 finding(s).");
    expect(md).toContain("| | Subject | Finding | What to do |");
    expect(md).toContain("`GHSA-x`");
    expect(md).toContain("update the dependency");
  });

  it("escapes a pipe so one detail cannot break the table", () => {
    const md = formatMarkdown(
      verdict([finding({ status: "bad-signature", detail: "a || b", failed: true })]),
    );
    expect(md).toContain("a \\|\\| b");
  });

  it("ends with a newline so an appended summary does not run on", () => {
    expect(formatMarkdown(verdict([finding()])).endsWith("\n")).toBe(true);
  });
});

describe("retiredKeyCount", () => {
  it("counts only the retired-key findings", () => {
    expect(retiredKeyCount(verdict([finding(), finding({ status: "retired-key" })]))).toBe(1);
    expect(retiredKeyCount(verdict([finding()]))).toBe(0);
  });
});
