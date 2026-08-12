import { Suspense } from "react";
import { screen, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ReportBreakdown, ReportBreakdownSkeleton } from "@/components/suspense/ReportBreakdown";
import { createInMemoryReportApi, DEMO_BREAKDOWN } from "@/lib/reportApi";
import { createReportCache } from "@/lib/reportCache";
import { actAsync, renderAsync } from "@/test/renderSuspense";
import { createDeferredReportApi } from "@/test/reportHarness";

describe("ReportBreakdown", () => {
  it("renders a row per channel once the data arrives", async () => {
    const api = createDeferredReportApi();
    const cache = createReportCache(api);

    await renderAsync(
      <Suspense fallback={<ReportBreakdownSkeleton />}>
        <ReportBreakdown cache={cache} />
      </Suspense>,
    );

    expect(screen.getByTestId("report-breakdown-skeleton")).toBeInTheDocument();

    await actAsync(() => api.resolve("breakdown"));

    const table = within(screen.getByTestId("report-breakdown"));
    for (const row of DEMO_BREAKDOWN) {
      expect(table.getByRole("rowheader", { name: row.channel })).toBeInTheDocument();
    }
  });

  it("totals the revenue column", async () => {
    const cache = createReportCache(
      createInMemoryReportApi({
        breakdown: [
          { channel: "Direct", orders: 2, revenue: 1_000 },
          { channel: "Partner", orders: 1, revenue: 250 },
        ],
      }),
    );

    await renderAsync(
      <Suspense fallback={<ReportBreakdownSkeleton />}>
        <ReportBreakdown cache={cache} />
      </Suspense>,
    );

    expect(await screen.findByTestId("breakdown-total")).toHaveTextContent("£1,250");
  });

  it("renders an empty table without a total of NaN", async () => {
    const cache = createReportCache(createInMemoryReportApi({ breakdown: [] }));

    await renderAsync(
      <Suspense fallback={<ReportBreakdownSkeleton />}>
        <ReportBreakdown cache={cache} />
      </Suspense>,
    );

    expect(await screen.findByTestId("breakdown-total")).toHaveTextContent("£0");
  });
});

describe("ReportBreakdownSkeleton", () => {
  it("announces itself once", async () => {
    await renderAsync(<ReportBreakdownSkeleton />);

    expect(screen.getByRole("status", { name: "Loading revenue by channel" })).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
