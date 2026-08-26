import { Suspense, type ReactNode } from "react";
import { screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ReportShell, ReportShellSkeleton } from "@/entities/report/ReportShell";
import { createReportCache, type ReportCache } from "@/entities/report/reportCache";
import { actAsync, renderAsync, type RenderSuspenseResult } from "@/test/renderSuspense";
import { createDeferredReportApi, type DeferredReportApi } from "@/test/reportHarness";

async function renderShell(
  children?: ReactNode,
): Promise<RenderSuspenseResult & { cache: ReportCache; api: DeferredReportApi }> {
  const api = createDeferredReportApi();
  const cache = createReportCache(api);
  const rendered = await renderAsync(
    <Suspense fallback={<ReportShellSkeleton />}>
      <ReportShell cache={cache}>{children}</ReportShell>
    </Suspense>,
  );
  return { ...rendered, cache, api };
}

describe("ReportShell", () => {
  it("renders the summary once it arrives", async () => {
    const { api } = await renderShell();

    expect(screen.getByTestId("report-shell-skeleton")).toBeInTheDocument();

    await actAsync(() => api.resolve("summary"));

    expect(screen.getByRole("heading", { name: "Q3 revenue report" })).toBeInTheDocument();
    expect(screen.getByText("1 Jul – 30 Sep 2026")).toBeInTheDocument();
    expect(screen.getByTestId("report-revenue")).toHaveTextContent("£482,900");
    expect(screen.getByTestId("report-orders")).toHaveTextContent("3,182");
  });

  it("does not render its children until the summary has resolved", async () => {
    // The gate the whole pattern is about: children are elements the caller
    // created, and an element is not a render. Nothing inside starts a
    // request of its own until this commits.
    const { api } = await renderShell(<p data-testid="section">section</p>);

    expect(screen.queryByTestId("section")).not.toBeInTheDocument();

    await actAsync(() => api.resolve("summary"));

    expect(screen.getByTestId("report-shell")).toBeInTheDocument();
    expect(screen.getByTestId("section")).toBeInTheDocument();
  });

  it("reads the summary exactly once across re-renders", async () => {
    const { api, cache, rerenderAsync } = await renderShell();
    await actAsync(() => api.resolve("summary"));

    await rerenderAsync(
      <Suspense fallback={<ReportShellSkeleton />}>
        <ReportShell cache={cache} />
      </Suspense>,
    );

    expect(cache.startedSections()).toEqual(["summary"]);
  });
});

describe("ReportShellSkeleton", () => {
  it("announces loading once, with decorative bars", async () => {
    await renderAsync(<ReportShellSkeleton />);

    expect(screen.getByRole("status", { name: "Loading report" })).toBeInTheDocument();
    // One announcement for the region, not one per bar — per-bar labels flood
    // screen readers and collide with the real controls' accessible names.
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("carries the section fallbacks a flat layout gives it", async () => {
    await renderAsync(
      <ReportShellSkeleton>
        <p data-testid="nested-fallback">rows</p>
      </ReportShellSkeleton>,
    );

    expect(screen.getByTestId("nested-fallback")).toBeInTheDocument();
  });
});
