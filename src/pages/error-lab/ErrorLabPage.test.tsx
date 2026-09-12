import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ErrorLabPage } from "@/pages/error-lab/ErrorLabPage";

let consoleErrorSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  sessionStorage.clear();
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

function renderLab(initialEntry = "/labs/errors") {
  const router = createMemoryRouter([{ path: "/labs/errors", element: <ErrorLabPage /> }], {
    initialEntries: [initialEntry],
  });
  return render(<RouterProvider router={router} />);
}

describe("ErrorLabPage", () => {
  it("renders the subject when nothing is failing", () => {
    renderLab();
    expect(screen.getByTestId("lab-subject")).toBeInTheDocument();
    expect(screen.queryByTestId("route-error")).not.toBeInTheDocument();
  });

  it("falls back to the working arm for an unrecognised mode", () => {
    renderLab("/labs/errors?mode=not-a-mode");
    expect(screen.getByTestId("lab-subject")).toBeInTheDocument();
  });

  it("shows the boundary's fallback for a render error, and recovers on retry", async () => {
    const user = userEvent.setup();
    renderLab("/labs/errors?mode=render");

    expect(screen.getByTestId("route-error")).toHaveAttribute("data-kind", "render");
    await user.click(screen.getByTestId("lab-heal"));
    fireEvent.click(screen.getByTestId("route-error-retry"));

    expect(screen.getByTestId("lab-subject")).toBeInTheDocument();
    expect(screen.getByText(/Recovered on attempt 1/)).toBeInTheDocument();
  });

  it("gives up on retries for the deterministic arm", () => {
    renderLab("/labs/errors?mode=deterministic");
    fireEvent.click(screen.getByTestId("route-error-retry"));
    fireEvent.click(screen.getByTestId("route-error-retry"));
    expect(screen.queryByTestId("route-error-retry")).not.toBeInTheDocument();
    expect(screen.getByTestId("route-error-reload")).toBeInTheDocument();
  });

  it("offers only a reload for a stale chunk", () => {
    renderLab("/labs/errors?mode=chunk");
    expect(screen.getByTestId("route-error")).toHaveAttribute("data-kind", "chunk-load");
    expect(screen.queryByTestId("route-error-retry")).not.toBeInTheDocument();
  });

  it("survives a thrown string", () => {
    renderLab("/labs/errors?mode=nonError");
    expect(screen.getByTestId("route-error")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("refresh-events"));
    expect(screen.getByTestId("event-list")).toHaveTextContent("the server said no");
  });

  it("clears the boundary when the mode changes, the mode being a navigation", async () => {
    const user = userEvent.setup();
    renderLab("/labs/errors?mode=deterministic");
    expect(screen.getByTestId("route-error")).toBeInTheDocument();

    await user.click(screen.getByTestId("mode-none"));

    expect(screen.queryByTestId("route-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("lab-subject")).toBeInTheDocument();
  });

  it("lists the reported event with its fingerprint and root cause", () => {
    renderLab("/labs/errors?mode=render");
    fireEvent.click(screen.getByTestId("refresh-events"));

    const list = screen.getByTestId("event-list");
    expect(list).toHaveTextContent("Could not read the dashboard summary");
    // The cause chain is what makes the fingerprint the root's, not the
    // wrapper's.
    expect(list).toHaveTextContent("ECONNREFUSED");
    expect(list).toHaveTextContent("surface=error-lab");
  });

  it("records one event per retry attempt", () => {
    renderLab("/labs/errors?mode=deterministic");
    fireEvent.click(screen.getByTestId("route-error-retry"));
    fireEvent.click(screen.getByTestId("route-error-retry"));
    fireEvent.click(screen.getByTestId("refresh-events"));

    expect(screen.getByTestId("event-list").querySelectorAll("li")).toHaveLength(3);
  });

  it("says nothing has been reported before anything throws", () => {
    renderLab();
    expect(screen.getByTestId("event-list")).toHaveTextContent("Nothing reported yet.");
  });
});
