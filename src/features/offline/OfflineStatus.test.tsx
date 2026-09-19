import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OfflineStatus } from "@/features/offline/OfflineStatus";
import type { OfflineState } from "@/shared/offline/offlineClient";

/**
 * A state to render, with the uninteresting fields filled in.
 *
 * The component is presentational — the shell's one subscription lives in
 * `<OfflineIndicators>` — so these tests hand it a state rather than driving a
 * client, and the callbacks are plain spies.
 */
function state(overrides: Partial<OfflineState> = {}): OfflineState {
  return {
    online: true,
    pending: 0,
    syncing: false,
    unsent: { count: 0, writes: [] },
    updateReady: false,
    ...overrides,
  };
}

const noop = (): void => undefined;

function renderStatus(
  overrides: Partial<OfflineState> = {},
  handlers: { onReplayNow?: () => void; onApplyUpdate?: () => void } = {},
) {
  return render(
    <OfflineStatus
      state={state(overrides)}
      onReplayNow={handlers.onReplayNow ?? noop}
      onApplyUpdate={handlers.onApplyUpdate ?? noop}
    />,
  );
}

describe("OfflineStatus", () => {
  it("renders nothing when there is nothing to say", () => {
    // A permanent "you are online" badge is an advertisement, not information.
    const { container } = renderStatus();
    expect(container).toBeEmptyDOMElement();
  });

  it("says the application is working from saved data when offline", () => {
    renderStatus({ online: false });

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Offline — showing saved data");
    // Polite rather than assertive: a dropped connection is worth saying, and
    // not worth saying over the top of whatever a screen reader is reading.
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it.each([
    [1, "1 change waiting to sync"],
    [3, "3 changes waiting to sync"],
  ])("counts %i queued writes rather than implying they are saved", (pending, expected) => {
    renderStatus({ online: false, pending });
    expect(screen.getByTestId("offline-pending")).toHaveTextContent(expected);
  });

  it("reports queued writes even after the connection returns", () => {
    // The window between "online again" and "queue drained" is exactly when a
    // user is most likely to close the tab.
    renderStatus({ online: true, pending: 2 });
    expect(screen.getByTestId("offline-pending")).toHaveTextContent("2 changes waiting to sync");
  });

  it("says a replay is in flight instead of still counting what is queued", () => {
    // "Three changes waiting" describes both the tunnel and the ten seconds
    // after it, and only one of those is a state where the right thing for the
    // user to do is wait.
    renderStatus({ online: true, pending: 3, syncing: true });

    expect(screen.getByTestId("offline-syncing")).toHaveTextContent("Sending your changes…");
    expect(screen.queryByTestId("offline-pending")).not.toBeInTheDocument();
  });

  it("offers a manual replay when the queue has stalled on a working connection", async () => {
    // The queue backs off for up to five minutes after a failure. A user
    // watching a stalled count on a connection that visibly works knows
    // something the schedule does not.
    const onReplayNow = vi.fn();
    renderStatus({ online: true, pending: 2 }, { onReplayNow });

    await userEvent.click(screen.getByRole("button", { name: "Try now" }));

    expect(onReplayNow).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["offline", { online: false, pending: 2 }],
    ["a pass is already in flight", { online: true, pending: 2, syncing: true }],
    ["there is nothing queued", { online: true, pending: 0, updateReady: true }],
  ])("withholds the replay button when %s", (_case, overrides) => {
    // A button that provably cannot do anything is worse than no button.
    renderStatus(overrides);
    expect(screen.queryByRole("button", { name: "Try now" })).not.toBeInTheDocument();
  });

  it("says nothing at all once a replay has succeeded", () => {
    /*
      Deliberate: the banner disappearing *is* the feedback, and the reconciled
      data arrives underneath it. A "3 changes synced" notice on top of that is
      a second notification for an outcome the user can already see, and it
      trains people to dismiss the banner that matters — which is the one about
      the writes that did not make it, rendered by `<UnsentWritesNotice>`.
    */
    const { container } = renderStatus({ online: true, pending: 0, syncing: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("offers an update instead of taking it", async () => {
    const onApplyUpdate = vi.fn();
    renderStatus({ updateReady: true }, { onApplyUpdate });

    const button = screen.getByRole("button", { name: /new version is ready/i });
    expect(onApplyUpdate).not.toHaveBeenCalled();

    await userEvent.click(button);

    expect(onApplyUpdate).toHaveBeenCalledTimes(1);
  });

  it("disappears once the queue drains and the connection is back", () => {
    const { rerender, container } = render(
      <OfflineStatus
        state={state({ online: false, pending: 2 })}
        onReplayNow={noop}
        onApplyUpdate={noop}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();

    rerender(
      <OfflineStatus
        state={state({ online: true, pending: 0 })}
        onReplayNow={noop}
        onApplyUpdate={noop}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
