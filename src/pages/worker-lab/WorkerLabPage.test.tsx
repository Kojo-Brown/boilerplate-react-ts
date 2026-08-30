import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeCsvWorker, type FakeWorker } from "@/test/workerChannel";
import { WorkerLabPage } from "@/pages/worker-lab/WorkerLabPage";

function renderLab(search = "") {
  const workers: FakeWorker[] = [];
  const createWorker = (): FakeWorker => {
    const worker = createFakeCsvWorker();
    workers.push(worker);
    return worker;
  };

  const router = createMemoryRouter(
    [{ path: "/labs/workers", element: <WorkerLabPage createWorker={createWorker} /> }],
    { initialEntries: [`/labs/workers${search}`] },
  );
  renderWithProviders(<RouterProvider router={router} />);
  return { workers, router };
}

/** The 10k sample is the smallest offered; everything here uses it. */
const SMALL = "?rows=10000";

describe("WorkerLabPage", () => {
  it("starts with no sample, no result and no recording", () => {
    renderLab();

    expect(screen.getByTestId("sample-summary")).toHaveTextContent("No sample built yet.");
    expect(screen.getByTestId("result-empty")).toBeInTheDocument();
    expect(screen.getByTestId("frame-stats-empty")).toBeInTheDocument();
    expect(screen.getByTestId("run-parse")).toBeDisabled();
  });

  it("reads the sample size and arm from the URL", () => {
    renderLab("?rows=200000&mode=main");

    expect(screen.getByRole("button", { name: "200,000 rows" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Main thread" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("run-parse")).toHaveTextContent("Parse on main thread");
  });

  it("falls back to the defaults for an unrecognised query", () => {
    renderLab("?rows=7&mode=gpu");

    expect(screen.getByRole("button", { name: "50,000 rows" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Worker" })).toHaveAttribute("aria-pressed", "true");
  });

  it("writes the chosen size back to the URL", async () => {
    const user = userEvent.setup();
    const { router } = renderLab(SMALL);

    await user.click(screen.getByRole("button", { name: "200,000 rows" }));

    expect(router.state.location.search).toContain("rows=200000");
  });

  it("builds a sample and reports its size", async () => {
    const user = userEvent.setup();
    renderLab(SMALL);

    await user.click(screen.getByTestId("build-sample"));

    expect(screen.getByTestId("sample-summary")).toHaveTextContent("10,000 rows");
    expect(screen.getByTestId("sample-summary")).toHaveTextContent(/KiB|MiB/);
    expect(screen.getByTestId("run-parse")).toBeEnabled();
  });

  it("parses in the worker and reports the same totals the parser produces", async () => {
    const user = userEvent.setup();
    renderLab(SMALL);

    await user.click(screen.getByTestId("build-sample"));
    await user.click(screen.getByTestId("run-parse"));

    await waitFor(() => {
      expect(screen.getByTestId("parse-status")).toHaveAttribute("data-status", "complete");
    });

    // 10,000 rows with one malformed row in every 500.
    expect(screen.getByTestId("result-summary")).toHaveTextContent("9,980");
    expect(screen.getByTestId("result-summary")).toHaveTextContent("20");
    expect(screen.getAllByRole("row").length).toBeGreaterThan(1);
  });

  it("starts exactly one worker across repeated parses", async () => {
    const user = userEvent.setup();
    const { workers } = renderLab(SMALL);

    await user.click(screen.getByTestId("build-sample"));
    await user.click(screen.getByTestId("run-parse"));
    await waitFor(() => {
      expect(screen.getByTestId("parse-status")).toHaveAttribute("data-status", "complete");
    });
    await user.click(screen.getByTestId("run-parse"));
    await waitFor(() => {
      expect(screen.getByTestId("parse-status")).toHaveAttribute("data-status", "complete");
    });

    expect(workers).toHaveLength(1);
  });

  it("enables Cancel only while the worker is parsing", async () => {
    const user = userEvent.setup();
    renderLab("?rows=200000");

    expect(screen.getByTestId("cancel-parse")).toBeDisabled();
    await user.click(screen.getByTestId("build-sample"));
    await user.click(screen.getByTestId("run-parse"));

    await waitFor(() => {
      expect(screen.getByTestId("cancel-parse")).toBeEnabled();
    });

    await user.click(screen.getByTestId("cancel-parse"));
    await waitFor(() => {
      expect(screen.getByTestId("parse-status")).toHaveAttribute("data-status", "cancelled");
    });
    expect(screen.getByTestId("parse-status")).toHaveTextContent(/Cancelled after/);
    expect(screen.getByTestId("cancel-parse")).toBeDisabled();
  });

  it("leaves Cancel disabled in the main-thread arm, because nothing could press it", async () => {
    const user = userEvent.setup();
    renderLab(`${SMALL}&mode=main`);

    await user.click(screen.getByTestId("build-sample"));
    expect(screen.getByTestId("cancel-parse")).toBeDisabled();
  });

  it("parses on the main thread and reports the same totals", async () => {
    const user = userEvent.setup();
    renderLab(`${SMALL}&mode=main`);

    await user.click(screen.getByTestId("build-sample"));
    await user.click(screen.getByTestId("run-parse"));

    await waitFor(
      () => {
        expect(screen.getByTestId("parse-status")).toHaveAttribute("data-status", "complete");
      },
      { timeout: 5_000 },
    );
    expect(screen.getByTestId("result-summary")).toHaveTextContent("9,980");
  });

  it("clears the previous result when a new sample is built", async () => {
    const user = userEvent.setup();
    renderLab(SMALL);

    await user.click(screen.getByTestId("build-sample"));
    await user.click(screen.getByTestId("run-parse"));
    await waitFor(() => {
      expect(screen.getByTestId("parse-status")).toHaveAttribute("data-status", "complete");
    });

    await user.click(screen.getByTestId("build-sample"));

    // A result left on screen under a freshly built sample reads as this
    // sample's, which is the only way the two arms could be misread as
    // disagreeing.
    expect(screen.getByTestId("result-empty")).toBeInTheDocument();
    expect(screen.getByTestId("parse-status")).toHaveAttribute("data-status", "idle");
  });

  it("terminates the worker when the page unmounts", async () => {
    const user = userEvent.setup();
    const { workers, router } = renderLab(SMALL);

    await user.click(screen.getByTestId("build-sample"));
    await user.click(screen.getByTestId("run-parse"));
    await waitFor(() => {
      expect(screen.getByTestId("parse-status")).toHaveAttribute("data-status", "complete");
    });

    await router.navigate("/gone");
    await waitFor(() => {
      expect(workers[0]?.isTerminated()).toBe(true);
    });
  });
});
