import { Suspense } from "react";
import { screen, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ReportActivity, ReportActivitySkeleton } from "@/entities/report/ReportActivity";
import { createInMemoryReportApi, DEMO_ACTIVITY } from "@/entities/report/reportApi";
import { createReportCache } from "@/entities/report/reportCache";
import { actAsync, renderAsync } from "@/test/renderSuspense";
import { createDeferredReportApi } from "@/test/reportHarness";

describe("ReportActivity", () => {
  it("renders an entry per event once the data arrives", async () => {
    const api = createDeferredReportApi();
    const cache = createReportCache(api);

    await renderAsync(
      <Suspense fallback={<ReportActivitySkeleton />}>
        <ReportActivity cache={cache} />
      </Suspense>,
    );

    expect(screen.getByTestId("report-activity-skeleton")).toBeInTheDocument();

    await actAsync(() => api.resolve("activity"));

    const feed = within(screen.getByTestId("report-activity"));
    expect(feed.getAllByRole("listitem")).toHaveLength(DEMO_ACTIVITY.length);
    expect(feed.getByText("Marketplace payout reconciled")).toBeInTheDocument();
  });

  it("marks each timestamp up as a time", async () => {
    const cache = createReportCache(
      createInMemoryReportApi({
        activity: [{ id: "a-1", at: "09:42", message: "Payout reconciled" }],
      }),
    );

    await renderAsync(
      <Suspense fallback={<ReportActivitySkeleton />}>
        <ReportActivity cache={cache} />
      </Suspense>,
    );

    const time = within(await screen.findByTestId("report-activity")).getByText("09:42");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", "09:42");
  });

  it("renders an empty feed without crashing", async () => {
    const cache = createReportCache(createInMemoryReportApi({ activity: [] }));

    await renderAsync(
      <Suspense fallback={<ReportActivitySkeleton />}>
        <ReportActivity cache={cache} />
      </Suspense>,
    );

    const feed = within(await screen.findByTestId("report-activity"));
    expect(feed.queryAllByRole("listitem")).toHaveLength(0);
  });
});

describe("ReportActivitySkeleton", () => {
  it("announces itself once", async () => {
    await renderAsync(<ReportActivitySkeleton />);

    expect(screen.getByRole("status", { name: "Loading recent activity" })).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
