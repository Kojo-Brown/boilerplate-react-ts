// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { Verdict } from "./evaluate.ts";
import { formatBytes, formatMarkdown, formatText } from "./report.ts";

const verdict: Verdict = {
  compression: "gzip",
  failed: true,
  findings: [
    { id: "chunk.index", detail: "assets/index-a.js", status: "ok", actual: 100, budget: 200 },
    { id: "initial.js", detail: "5 chunks", status: "over", actual: 190_000, budget: 180_000 },
    {
      id: "chunk.new",
      detail: "assets/new-b.js",
      status: "missing-budget",
      actual: 900,
      budget: null,
    },
    {
      id: "chunk.gone",
      detail: "chunk is no longer in the initial graph",
      status: "stale-budget",
      actual: null,
      budget: 500,
    },
  ],
};

describe("formatBytes", () => {
  it("uses decimal kB, the unit Vite's own build output prints", () => {
    // A gate that says 176.06 kB next to a build log that says 176.06 kB is a
    // gate people trust. Switching to KiB here would put the two 2.4% apart
    // with no explanation on screen.
    expect(formatBytes(176_060)).toBe("176.06 kB");
  });

  it("stays in bytes below a kilobyte", () => {
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1000)).toBe("1.00 kB");
  });
});

describe("formatText", () => {
  const text = formatText(verdict);

  it("marks only the failing rows", () => {
    const lines = text.split("\n");
    expect(lines.find((l) => l.includes("chunk.index"))?.startsWith("  ")).toBe(true);
    expect(lines.find((l) => l.includes("initial.js"))?.startsWith("! ")).toBe(true);
  });

  it("signs the delta in the direction it moved", () => {
    expect(text).toContain("+10.00 kB (+5.6%)");
    expect(text).toContain("-100 B (-50.0%)");
  });

  it("says what to do about a row that is not simply over budget", () => {
    expect(text).toContain("add one to bundle-budget.json");
    expect(text).toContain("remove it");
  });

  it("ends with a verdict, and says which compression produced the numbers", () => {
    expect(text).toContain("sizes are gzip");
    expect(
      text.trimEnd().endsWith("what each id measures and when raising one is the right call."),
    ).toBe(true);
    expect(
      formatText({ ...verdict, failed: false })
        .trimEnd()
        .endsWith("PASS — every budget met."),
    ).toBe(true);
  });
});

describe("formatMarkdown", () => {
  it("renders one table row per finding under a header row", () => {
    const rows = formatMarkdown(verdict)
      .split("\n")
      .filter((l) => l.startsWith("| "));
    expect(rows).toHaveLength(verdict.findings.length + 2);
  });

  it("leads with the outcome, since the summary is read collapsed", () => {
    expect(formatMarkdown(verdict).startsWith("### Bundle budget — ❌ failed")).toBe(true);
    expect(
      formatMarkdown({ ...verdict, failed: false }).startsWith("### Bundle budget — ✅ passed"),
    ).toBe(true);
  });

  it("prints an em dash rather than a number for a budget with nothing to measure", () => {
    expect(formatMarkdown(verdict)).toContain("| ❌ | `chunk.gone` | — | 500 B | — |");
  });
});
