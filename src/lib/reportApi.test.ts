import { describe, it, expect, vi } from "vitest";
import {
  createInMemoryReportApi,
  wereConcurrent,
  DEMO_BREAKDOWN,
  DEMO_SUMMARY,
  ReportApiError,
  REPORT_SECTIONS,
  type RequestEvent,
} from "@/lib/reportApi";

describe("createInMemoryReportApi", () => {
  it("resolves each section with its demo data", async () => {
    const api = createInMemoryReportApi();

    await expect(api.fetchSummary()).resolves.toEqual(DEMO_SUMMARY);
    await expect(api.fetchBreakdown()).resolves.toEqual(DEMO_BREAKDOWN);
    await expect(api.fetchActivity()).resolves.toHaveLength(3);
  });

  it("never settles synchronously, even at zero latency", async () => {
    const api = createInMemoryReportApi();
    const settled = vi.fn();

    void api.fetchSummary().then(settled);
    await Promise.resolve();

    // A promise already settled when `use()` first sees it does not suspend,
    // so a zero-latency service that resolved synchronously would quietly stop
    // exercising the Suspense path.
    expect(settled).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(settled).toHaveBeenCalled();
  });

  it("rejects the section the predicate names, and only that one", async () => {
    const api = createInMemoryReportApi({
      failWhen: (section) => (section === "breakdown" ? "Breakdown unavailable" : null),
    });

    await expect(api.fetchBreakdown()).rejects.toBeInstanceOf(ReportApiError);
    await expect(api.fetchBreakdown()).rejects.toThrow("Breakdown unavailable");
    await expect(api.fetchSummary()).resolves.toEqual(DEMO_SUMMARY);
  });

  it("records a start and a settle for every request, including failures", async () => {
    const api = createInMemoryReportApi({ failWhen: () => "down" });

    await expect(api.fetchActivity()).rejects.toThrow("down");

    expect(api.timeline()).toEqual([
      { kind: "start", section: "activity" },
      { kind: "settle", section: "activity" },
    ]);
  });

  it("notifies a subscriber as each event is recorded", async () => {
    const seen: RequestEvent[] = [];
    const api = createInMemoryReportApi({
      onEvent: (event) => seen.push(event),
    });

    await api.fetchSummary();

    expect(seen).toEqual(api.timeline());
  });

  it("hands out a copy of the timeline", async () => {
    const api = createInMemoryReportApi();
    const before = api.timeline();

    await api.fetchSummary();

    // A live array would let a caller's snapshot change under it, which is the
    // opposite of what a timeline is for.
    expect(before).toHaveLength(0);
    expect(api.timeline()).toHaveLength(2);
  });

  it("orders the timeline by settle time, not by start order", async () => {
    const api = createInMemoryReportApi({
      latencyMs: { summary: 40, activity: 5 },
    });

    await Promise.all([api.fetchSummary(), api.fetchActivity()]);

    expect(api.timeline()).toEqual([
      { kind: "start", section: "summary" },
      { kind: "start", section: "activity" },
      { kind: "settle", section: "activity" },
      { kind: "settle", section: "summary" },
    ]);
  });
});

describe("REPORT_SECTIONS", () => {
  it("lists the sections in page order", () => {
    expect(REPORT_SECTIONS).toEqual(["summary", "breakdown", "activity"]);
  });
});

describe("wereConcurrent", () => {
  const events = (...pairs: readonly (readonly [RequestEvent["kind"], string])[]): RequestEvent[] =>
    pairs.map(([kind, section]) => ({
      kind,
      section: section as RequestEvent["section"],
    }));

  it("is true when the second request started before the first settled", () => {
    const timeline = events(
      ["start", "summary"],
      ["start", "breakdown"],
      ["settle", "summary"],
      ["settle", "breakdown"],
    );

    expect(wereConcurrent(timeline, "summary", "breakdown")).toBe(true);
  });

  it("is symmetric", () => {
    const timeline = events(
      ["start", "summary"],
      ["start", "breakdown"],
      ["settle", "summary"],
      ["settle", "breakdown"],
    );

    expect(wereConcurrent(timeline, "breakdown", "summary")).toBe(true);
  });

  it("is false for a waterfall — the second started after the first settled", () => {
    const timeline = events(
      ["start", "summary"],
      ["settle", "summary"],
      ["start", "breakdown"],
      ["settle", "breakdown"],
    );

    expect(wereConcurrent(timeline, "summary", "breakdown")).toBe(false);
  });

  it("treats a request that has not settled as still in flight", () => {
    const timeline = events(["start", "summary"], ["start", "breakdown"]);

    expect(wereConcurrent(timeline, "summary", "breakdown")).toBe(true);
  });

  it("is false when either section never started", () => {
    const timeline = events(["start", "summary"], ["settle", "summary"]);

    expect(wereConcurrent(timeline, "summary", "breakdown")).toBe(false);
    expect(wereConcurrent([], "summary", "breakdown")).toBe(false);
  });

  it("reports a section as concurrent with itself once it has started", () => {
    const timeline = events(["start", "summary"], ["settle", "summary"]);

    // Degenerate but worth pinning: the interval overlaps itself, so a caller
    // comparing a section against a variable that happens to hold the same
    // name gets `true` rather than something arbitrary.
    expect(wereConcurrent(timeline, "summary", "summary")).toBe(true);
  });
});
