import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { LiveRegionsLabPage } from "@/pages/live-regions-lab/LiveRegionsLabPage";
import { LiveRegions } from "@/shared/a11y/LiveRegions";
import { ToastProvider } from "@/shared/ui/Toast";
import { announcer } from "@/shared/a11y/announcer";
import { observeAnnouncements, type AnnouncementRecorder } from "@/test/announcer";

const GAP_MS = 150;
const DEBOUNCE_MS = 500;
const PENDING_DELAY_MS = 500;

/**
 * The page against the *real* announcer and a real `<LiveRegions>`, because the
 * thing this page exists to demonstrate is the wiring — a lab that announced
 * into an injected double would pass while the app said nothing.
 */
function renderLab(): AnnouncementRecorder {
  const recorder = observeAnnouncements(announcer);
  render(
    <ToastProvider>
      <LiveRegions />
      <LiveRegionsLabPage />
    </ToastProvider>,
  );
  return recorder;
}

function pass(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function press(testId: string): void {
  act(() => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

describe("<LiveRegionsLabPage>", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a polite announcement to the polite regions only", () => {
    const recorder = renderLab();
    press("announce-polite");

    expect(recorder.spoken).toEqual([{ politeness: "polite", text: "Draft saved" }]);
    expect(screen.getByTestId("mirror-polite-text")).toHaveTextContent("Draft saved");
    expect(screen.getByTestId("mirror-assertive-text")).toHaveTextContent("silent");
    recorder.stop();
  });

  it("sends an assertive announcement to the assertive regions only", () => {
    const recorder = renderLab();
    press("announce-assertive");

    expect(recorder.texts("assertive")).toEqual(["Your session expires in one minute"]);
    expect(screen.getByTestId("mirror-polite-text")).toHaveTextContent("silent");
    recorder.stop();
  });

  it("announces the same message twice, from alternating slots", () => {
    const recorder = renderLab();

    press("announce-repeat");
    expect(screen.getByTestId("mirror-polite-slot")).toHaveTextContent("1");
    pass(GAP_MS);
    press("announce-repeat");

    // One region would have gone silent here: React declines to touch an
    // unchanged text node, and an unchanged text node is not an announcement.
    expect(recorder.texts()).toEqual(["No results", "No results"]);
    expect(screen.getByTestId("mirror-polite-slot")).toHaveTextContent("0");
    recorder.stop();
  });

  it("drains a burst one message at a time and collapses the duplicate", () => {
    const recorder = renderLab();
    press("announce-burst");

    expect(recorder.texts()).toEqual(["Row 1 archived"]);
    pass(GAP_MS);
    pass(GAP_MS);
    pass(GAP_MS);

    expect(recorder.texts()).toEqual(["Row 1 archived", "Row 2 archived", "Row 3 archived"]);
    recorder.stop();
  });

  it("announces a toast through the shared regions, not from the card", () => {
    const recorder = renderLab();
    press("toast-danger");

    expect(recorder.spoken).toEqual([
      { politeness: "assertive", text: "Upload failed. The file is larger than 10 MB" },
    ]);
    expect(screen.getByTestId("toast")).not.toHaveAttribute("role");
    recorder.stop();
  });

  it("says only the result for a load that finishes inside the delay", () => {
    const recorder = renderLab();
    fireEvent.click(screen.getByRole("radio", { name: /fast/ }));

    press("run-query");
    pass(200);

    expect(screen.getByTestId("query-status")).toHaveTextContent("success");
    expect(recorder.texts()).toEqual(["Report ready, 42 rows"]);
    recorder.stop();
  });

  it("says the load and then the result when the load outlives the delay", () => {
    const recorder = renderLab();

    press("run-query");
    pass(PENDING_DELAY_MS);
    expect(recorder.texts()).toEqual(["Loading the report"]);

    pass(1000);
    expect(recorder.texts()).toEqual(["Loading the report", "Report ready, 42 rows"]);
    recorder.stop();
  });

  it("interrupts for a failed load", () => {
    const recorder = renderLab();
    fireEvent.click(screen.getByTestId("should-fail"));

    press("run-query");
    pass(2000);

    expect(screen.getByTestId("query-status")).toHaveTextContent("error");
    expect(recorder.texts("assertive")).toEqual(["The report could not be loaded"]);
    recorder.stop();
  });

  it("announces the filter count once typing stops", () => {
    const recorder = renderLab();
    const input = screen.getByTestId("filter-input");

    for (const value of ["b", "bl", "blu"]) {
      act(() => {
        fireEvent.change(input, { target: { value } });
      });
      pass(DEBOUNCE_MS - 1);
    }
    expect(recorder.spoken).toEqual([]);

    pass(1);
    expect(screen.getByTestId("match-count")).toHaveTextContent("1");
    expect(recorder.texts()).toEqual(["1 match"]);
    recorder.stop();
  });

  it("says nothing about a filter that has been cleared", () => {
    const recorder = renderLab();
    const input = screen.getByTestId("filter-input");

    act(() => {
      fireEvent.change(input, { target: { value: "zzz" } });
    });
    act(() => {
      fireEvent.change(input, { target: { value: "" } });
    });
    pass(DEBOUNCE_MS * 2);

    expect(recorder.spoken).toEqual([]);
    recorder.stop();
  });
});
