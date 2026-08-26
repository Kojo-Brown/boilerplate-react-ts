import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import {
  StreamingReport,
  type BoundaryLayout,
  type LoadingStrategy,
} from "@/widgets/streaming-report/StreamingReport";
import {
  createInMemoryReportApi,
  wereConcurrent,
  type RequestEvent,
} from "@/entities/report/reportApi";
import { createReportCache, type ReportCache } from "@/entities/report/reportCache";
import { actAsync, renderAsync } from "@/test/renderSuspense";
import { createDeferredReportApi, type DeferredReportApi } from "@/test/reportHarness";

interface SetupOptions {
  boundaries?: BoundaryLayout;
  loading?: LoadingStrategy;
}

async function setup({ boundaries = "nested", loading = "parallel" }: SetupOptions = {}): Promise<{
  api: DeferredReportApi;
  cache: ReportCache;
}> {
  const api = createDeferredReportApi();
  const cache = createReportCache(api);

  await renderAsync(<StreamingReport cache={cache} boundaries={boundaries} loading={loading} />);

  return { api, cache };
}

const startOrder = (timeline: readonly RequestEvent[]): readonly string[] =>
  timeline.filter((event) => event.kind === "start").map((event) => event.section);

let consoleErrorSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("StreamingReport — nested boundaries", () => {
  it("shows the header as soon as the summary lands, while the sections are still loading", async () => {
    const { api } = await setup({ boundaries: "nested" });

    expect(screen.getByTestId("report-shell-skeleton")).toBeInTheDocument();

    await actAsync(() => api.resolve("summary"));

    expect(screen.getByTestId("report-shell")).toBeInTheDocument();
    expect(screen.getByTestId("report-breakdown-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("report-breakdown")).not.toBeInTheDocument();
  });

  it("does not render an inner fallback while the outer fallback is up", async () => {
    // The nested skeletons are not a second layer of spinner shown alongside
    // the first: a component inside a suspended boundary has not rendered at
    // all, so its own boundary does not exist yet. The reveal is two stages,
    // not one.
    await setup({ boundaries: "nested" });

    expect(screen.getByTestId("report-shell-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("report-breakdown-skeleton")).not.toBeInTheDocument();
    expect(screen.queryByTestId("report-activity-skeleton")).not.toBeInTheDocument();
  });

  it("reveals sections in completion order rather than source order", async () => {
    const { api } = await setup({ boundaries: "nested" });

    await actAsync(() => api.resolve("summary"));
    await actAsync(() => api.resolve("activity"));

    // Activity is second in the markup and first on screen. Sibling
    // boundaries are independent, and React 19 ships no stable way to hold a
    // fast one back — `<SuspenseList>` is still experimental.
    expect(screen.getByTestId("report-activity")).toBeInTheDocument();
    expect(screen.getByTestId("report-breakdown-skeleton")).toBeInTheDocument();

    await actAsync(() => api.resolve("breakdown"));

    expect(screen.getByTestId("report-breakdown")).toBeInTheDocument();
  });

  it("keeps a failing section from taking down its siblings", async () => {
    const { api } = await setup({ boundaries: "nested" });

    await actAsync(() => api.resolve("summary"));
    await actAsync(() => api.resolve("activity"));
    await actAsync(() => api.reject("breakdown", "Breakdown unavailable"));

    const error = await screen.findByTestId("section-error");
    expect(error).toHaveAttribute("data-section", "breakdown");
    expect(error).toHaveTextContent("Could not load breakdown.");
    expect(error).toHaveTextContent("Breakdown unavailable");

    // The blast radius is exactly the boundary the failure was inside.
    expect(screen.getByTestId("report-shell")).toBeInTheDocument();
    expect(screen.getByTestId("report-activity")).toBeInTheDocument();
  });

  it("recovers a failed section when the retry invalidates its entry first", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const api = createInMemoryReportApi({
      failWhen: (section) => {
        if (section !== "breakdown") return null;
        attempts += 1;
        return attempts === 1 ? "Reporting service unavailable" : null;
      },
    });
    const cache = createReportCache(api);

    await renderAsync(<StreamingReport cache={cache} boundaries="nested" loading="parallel" />);

    const retry = await screen.findByTestId("retry-section");
    await actAsync(() => user.click(retry));

    expect(await screen.findByTestId("report-breakdown")).toBeInTheDocument();
    expect(screen.queryByTestId("section-error")).not.toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("retries a failed activity feed without touching its siblings", async () => {
    const user = userEvent.setup();
    const { api } = await setup({ boundaries: "nested" });

    await actAsync(() => api.resolve("summary"));
    await actAsync(() => api.resolve("breakdown"));
    await actAsync(() => api.reject("activity", "Feed unavailable"));

    const error = await screen.findByTestId("section-error");
    expect(error).toHaveAttribute("data-section", "activity");

    await actAsync(() => user.click(within(error).getByTestId("retry-section")));
    await actAsync(() => api.resolve("activity"));

    expect(screen.getByTestId("report-activity")).toBeInTheDocument();
    // The breakdown was never re-requested: only the failing section's entry
    // was invalidated.
    expect(api.requested()).toEqual(["summary", "breakdown", "activity", "activity"]);
  });

  it("retries the shell when the summary itself fails", async () => {
    const user = userEvent.setup();
    const { api } = await setup({ boundaries: "nested" });

    await actAsync(() => api.reject("summary", "Summary unavailable"));

    const error = await screen.findByTestId("section-error");
    expect(error).toHaveAttribute("data-section", "report");

    await actAsync(() => user.click(within(error).getByTestId("retry-section")));
    await actAsync(() => api.resolve("summary"));

    expect(screen.getByTestId("report-shell")).toBeInTheDocument();
  });
});

describe("StreamingReport — one boundary", () => {
  it("holds the whole page until the slowest request settles", async () => {
    const { api } = await setup({ boundaries: "flat" });

    await actAsync(() => api.resolve("summary"));
    await actAsync(() => api.resolve("activity"));

    // Both of those are ready and none of it is on screen: with a single
    // boundary the reveal is all-or-nothing, decided by the slowest section.
    expect(screen.queryByTestId("report-shell")).not.toBeInTheDocument();
    expect(screen.queryByTestId("report-activity")).not.toBeInTheDocument();
    expect(screen.getByTestId("report-shell-skeleton")).toBeInTheDocument();

    await actAsync(() => api.resolve("breakdown"));

    expect(screen.getByTestId("report-shell")).toBeInTheDocument();
    expect(screen.getByTestId("report-breakdown")).toBeInTheDocument();
    expect(screen.getByTestId("report-activity")).toBeInTheDocument();
  });

  it("puts the section skeletons in the one fallback it has", async () => {
    // With nothing nested below, a fallback that showed only the header would
    // leave the sections' space blank for the whole wait.
    await setup({ boundaries: "flat" });

    expect(screen.getByTestId("report-shell-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("report-breakdown-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("report-activity-skeleton")).toBeInTheDocument();
  });

  it("loses every section when one of them fails", async () => {
    const { api } = await setup({ boundaries: "flat" });

    await actAsync(() => api.resolve("summary"));
    await actAsync(() => api.resolve("breakdown"));
    await actAsync(() => api.reject("activity", "Feed unavailable"));

    const error = await screen.findByTestId("section-error");
    expect(error).toHaveAttribute("data-section", "report");
    // The breakdown succeeded and is still not on screen. That is the cost of
    // the flat layout, and the reason to nest.
    expect(screen.queryByTestId("report-breakdown")).not.toBeInTheDocument();
    expect(screen.queryByTestId("report-shell")).not.toBeInTheDocument();
  });

  it("clears every section on retry, not just the one that failed", async () => {
    const user = userEvent.setup();
    const { api } = await setup({ boundaries: "flat" });

    await actAsync(() => api.resolve("summary"));
    await actAsync(() => api.resolve("breakdown"));
    await actAsync(() => api.reject("activity", "Feed unavailable"));

    const error = await screen.findByTestId("section-error");
    await actAsync(() => user.click(within(error).getByTestId("retry-section")));

    // Invalidating only the failed section would leave the summary settled, so
    // the reset would render the shell straight back — with a rejected
    // activity entry still cached underneath it, rethrowing in the same frame.
    // A boundary has to clear everything it stands in front of.
    expect(api.requested()).toEqual(["summary", "breakdown", "activity", "summary"]);

    await actAsync(() => api.resolve("summary"));
    await actAsync(() => api.resolve("breakdown"));
    await actAsync(() => api.resolve("activity"));

    expect(screen.getByTestId("report-shell")).toBeInTheDocument();
    expect(screen.getByTestId("report-activity")).toBeInTheDocument();
  });
});

describe("StreamingReport — request timing", () => {
  it("prefetching starts every section before the shell has resolved", async () => {
    const { api, cache } = await setup({ loading: "parallel" });

    // Nothing has settled yet and all three are already in flight.
    expect(api.requested()).toEqual(["summary", "breakdown", "activity"]);
    expect(cache.startedSections()).toEqual(["summary", "breakdown", "activity"]);
    expect(wereConcurrent(api.timeline(), "summary", "breakdown")).toBe(true);
    expect(wereConcurrent(api.timeline(), "breakdown", "activity")).toBe(true);
  });

  it("without a prefetch the sections wait on the shell", async () => {
    const { api } = await setup({ boundaries: "nested", loading: "waterfall" });

    // The sections have asked for nothing, because they have not rendered.
    expect(api.requested()).toEqual(["summary"]);

    await actAsync(() => api.resolve("summary"));

    expect(api.requested()).toEqual(["summary", "breakdown", "activity"]);
    expect(wereConcurrent(api.timeline(), "summary", "breakdown")).toBe(false);
    // With a boundary each, the two siblings do at least run alongside each
    // other — see the next test for what happens without one.
    expect(wereConcurrent(api.timeline(), "breakdown", "activity")).toBe(true);
  });

  it("serialises sibling requests when they share one boundary", async () => {
    const { api } = await setup({ boundaries: "flat", loading: "waterfall" });

    await actAsync(() => api.resolve("summary"));

    // Only the breakdown. A suspension abandons the render pass it happened
    // in, so the activity feed after it never rendered — and a component that
    // never rendered has not asked for anything.
    expect(api.requested()).toEqual(["summary", "breakdown"]);

    await actAsync(() => api.resolve("breakdown"));

    // It starts only now, on the retry pass that finally reaches it: three
    // round trips in series for a page with no dependency between its parts.
    expect(api.requested()).toEqual(["summary", "breakdown", "activity"]);
    expect(wereConcurrent(api.timeline(), "breakdown", "activity")).toBe(false);
  });

  it("nesting a boundary per sibling un-serialises them", async () => {
    const flat = await setup({ boundaries: "flat", loading: "waterfall" });
    await actAsync(() => flat.api.resolve("summary"));

    const nested = await setup({ boundaries: "nested", loading: "waterfall" });
    await actAsync(() => nested.api.resolve("summary"));

    // The same components, the same data, the same absent prefetch — and one
    // fewer round trip, purely because each suspension is fenced.
    expect(startOrder(flat.api.timeline())).toEqual(["summary", "breakdown"]);
    expect(startOrder(nested.api.timeline())).toEqual(["summary", "breakdown", "activity"]);
  });

  it("prefetching makes the boundary layout irrelevant to the network", async () => {
    const flat = await setup({ boundaries: "flat", loading: "parallel" });
    const nested = await setup({ boundaries: "nested", loading: "parallel" });

    // Once the requests are started above the boundary, nothing about where
    // the boundaries sit can delay them.
    expect(startOrder(flat.api.timeline())).toEqual(["summary", "breakdown", "activity"]);
    expect(startOrder(nested.api.timeline())).toEqual(startOrder(flat.api.timeline()));
  });

  it("starts each section exactly once no matter how often it re-renders", async () => {
    const { api, cache } = await setup({ loading: "parallel" });

    await actAsync(() => api.resolve("summary"));
    await actAsync(() => api.resolve("activity"));
    await actAsync(() => api.resolve("breakdown"));

    expect(cache.startedSections()).toEqual(["summary", "breakdown", "activity"]);
  });
});
