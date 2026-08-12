import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { StreamingLabPage } from "./StreamingLabPage";
import { actAsync, renderAsync } from "@/test/renderSuspense";

async function renderLab(search = "?latency=0") {
  const router = createMemoryRouter([{ path: "/labs/streaming", element: <StreamingLabPage /> }], {
    initialEntries: [`/labs/streaming${search}`],
  });
  return { router, ...(await renderAsync(<RouterProvider router={router} />)) };
}

const verdict = (): HTMLElement => screen.getByTestId("timeline-verdict");

let consoleErrorSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("StreamingLabPage", () => {
  it("renders the whole report against the default configuration", async () => {
    await renderLab();

    expect(
      screen.getByRole("heading", { level: 1, name: "Streaming Suspense Lab" }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId("report-shell")).toBeInTheDocument();
    expect(await screen.findByTestId("report-breakdown")).toBeInTheDocument();
    expect(await screen.findByTestId("report-activity")).toBeInTheDocument();
    expect(screen.queryByTestId("section-error")).not.toBeInTheDocument();
  });

  it("defaults to nested boundaries and prefetching", async () => {
    await renderLab();

    expect(screen.getByRole("button", { name: "Nested boundaries" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Prefetch" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await screen.findByTestId("streaming-report")).toHaveAttribute(
      "data-boundaries",
      "nested",
    );
  });

  it("reads the configuration from the URL", async () => {
    await renderLab("?boundaries=flat&loading=waterfall&latency=0");

    const report = screen.getByTestId("streaming-report");
    expect(report).toHaveAttribute("data-boundaries", "flat");
    expect(report).toHaveAttribute("data-loading", "waterfall");
    expect(screen.getByRole("button", { name: "One boundary" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("reports from the timeline that a prefetched run overlapped", async () => {
    await renderLab("?loading=parallel&latency=400");

    await waitFor(() => {
      expect(verdict()).toHaveTextContent("in flight together");
    });
  });

  it("reports from the timeline that a waterfall run did not", async () => {
    await renderLab("?loading=waterfall&latency=0");

    await waitFor(() => {
      expect(verdict()).toHaveTextContent("a waterfall");
    });
  });

  it("logs every request start and settle in order", async () => {
    await renderLab("?loading=waterfall&latency=0");

    await screen.findByTestId("report-breakdown");
    await waitFor(() => {
      expect(within(screen.getByTestId("request-timeline")).getAllByRole("listitem")).toHaveLength(
        6,
      );
    });

    const entries = within(screen.getByTestId("request-timeline"))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(entries[0]).toContain("start");
    expect(entries[0]).toContain("summary");
    expect(entries[1]).toContain("settle");
  });

  it("switches strategy through the URL and starts a fresh run", async () => {
    const user = userEvent.setup();
    const { router } = await renderLab("?latency=0");
    await screen.findByTestId("report-breakdown");

    await actAsync(() => user.click(screen.getByRole("button", { name: "Waterfall" })));

    expect(router.state.location.search).toContain("loading=waterfall");
    // A new run, not the old one relabelled: settled promises never suspend
    // again, so the subtree has to remount for the comparison to mean
    // anything.
    await waitFor(() => {
      expect(verdict()).toHaveTextContent("a waterfall");
    });
  });

  it("breaks exactly the section the URL names", async () => {
    await renderLab("?fail=breakdown&latency=0");

    const error = await screen.findByTestId("section-error");
    expect(error).toHaveAttribute("data-section", "breakdown");
    expect(error).toHaveTextContent("The reporting service is unavailable.");
    expect(await screen.findByTestId("report-activity")).toBeInTheDocument();
    expect(screen.getByTestId("report-shell")).toBeInTheDocument();
  });

  it("ignores a section name it does not recognise", async () => {
    await renderLab("?fail=nonsense&latency=0");

    expect(await screen.findByTestId("report-breakdown")).toBeInTheDocument();
    expect(screen.queryByTestId("section-error")).not.toBeInTheDocument();
  });

  it("re-runs on demand", async () => {
    const user = userEvent.setup();
    await renderLab("?latency=0");
    await screen.findByTestId("report-breakdown");

    await actAsync(() => user.click(screen.getByTestId("rerun-report")));

    // Six events again rather than twelve: the remount drops the previous
    // run's timeline along with its cache.
    await waitFor(() => {
      expect(within(screen.getByTestId("request-timeline")).getAllByRole("listitem")).toHaveLength(
        6,
      );
    });
    expect(await screen.findByTestId("report-breakdown")).toBeInTheDocument();
  });
});
