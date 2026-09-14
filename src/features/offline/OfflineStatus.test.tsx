import { describe, it, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OfflineStatus } from "@/features/offline/OfflineStatus";
import { createStubOfflineClient } from "@/test/offlineState";

describe("OfflineStatus", () => {
  it("renders nothing when there is nothing to say", () => {
    // A permanent "you are online" badge is an advertisement, not information.
    const { container } = render(<OfflineStatus client={createStubOfflineClient()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says the application is working from saved data when offline", () => {
    const client = createStubOfflineClient({ online: false });
    render(<OfflineStatus client={client} />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Offline — showing saved data");
    // Polite rather than assertive: a dropped connection is worth saying, and
    // not worth saying over the top of whatever a screen reader is reading.
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("counts queued writes rather than implying they are saved", () => {
    const client = createStubOfflineClient({ online: false, pending: 1 });
    render(<OfflineStatus client={client} />);
    expect(screen.getByTestId("offline-pending")).toHaveTextContent("1 change waiting to sync");

    act(() => {
      client.set({ pending: 3 });
    });
    expect(screen.getByTestId("offline-pending")).toHaveTextContent("3 changes waiting to sync");
  });

  it("reports queued writes even after the connection returns", () => {
    // The window between "online again" and "queue drained" is exactly when a
    // user is most likely to close the tab.
    const client = createStubOfflineClient({ online: true, pending: 2 });
    render(<OfflineStatus client={client} />);
    expect(screen.getByTestId("offline-pending")).toHaveTextContent("2 changes waiting to sync");
  });

  it("offers an update instead of taking it", async () => {
    const client = createStubOfflineClient({ updateReady: true });
    render(<OfflineStatus client={client} />);

    const button = screen.getByRole("button", { name: /new version is ready/i });
    expect(client.updatesApplied()).toBe(0);

    await userEvent.click(button);

    expect(client.updatesApplied()).toBe(1);
  });

  it("disappears once the queue drains and the connection is back", () => {
    const client = createStubOfflineClient({ online: false, pending: 2 });
    const { container } = render(<OfflineStatus client={client} />);
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => {
      client.set({ online: true, pending: 0 });
    });

    expect(container).toBeEmptyDOMElement();
  });
});
