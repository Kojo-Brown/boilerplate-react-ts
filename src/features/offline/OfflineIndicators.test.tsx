import { describe, it, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OfflineIndicators } from "@/features/offline/OfflineIndicators";
import { createStubOfflineClient } from "@/test/offlineState";

describe("OfflineIndicators", () => {
  it("renders nothing while there is nothing to report", () => {
    const { container } = render(<OfflineIndicators client={createStubOfflineClient()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("subscribes exactly once for both indicators", () => {
    /*
      The reason this component exists rather than the two indicators each
      reading the store.

      Reading an external store during a concurrent render is the thing React
      cannot time-slice: every subscribed snapshot is re-read before the
      commit, so a store read in the shell is paid for by every deferred update
      beneath it. The version with two subscriptions moved worst
      keypress-to-paint in `e2e/concurrency-benchmark.spec.ts` from ~96ms to
      ~250ms, which is a benchmark failure and, more to the point, a user
      waiting a quarter of a second for a keystroke.
    */
    const client = createStubOfflineClient({ online: false, unsent: { count: 1, writes: [] } });
    render(<OfflineIndicators client={client} />);

    // Both indicators are on screen, so this is one subscription for two
    // consumers rather than one consumer.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(client.listenerCount()).toBe(1);
  });

  it("releases the subscription when it unmounts", () => {
    const client = createStubOfflineClient({ online: false });
    const { unmount } = render(<OfflineIndicators client={client} />);
    expect(client.listenerCount()).toBe(1);

    unmount();

    expect(client.listenerCount()).toBe(0);
  });

  it("keeps both regions separate rather than folding them into one", () => {
    // Two urgencies: connectivity is polite, lost work is assertive. One
    // region changing between the two is something assistive technology has no
    // way to convey.
    const client = createStubOfflineClient({
      online: false,
      pending: 1,
      unsent: { count: 1, writes: [{ method: "POST", url: "/api/posts", fate: "exhausted" }] },
    });
    render(<OfflineIndicators client={client} />);

    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("alert")).toHaveTextContent("1 change could not be saved");
  });

  it("re-renders both indicators when the state changes", () => {
    const client = createStubOfflineClient();
    render(<OfflineIndicators client={client} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => {
      client.set({ online: false, unsent: { count: 2, writes: [] } });
    });

    expect(screen.getByRole("status")).toHaveTextContent("Offline");
    expect(screen.getByRole("alert")).toHaveTextContent("2 changes could not be saved");
  });

  it("wires each indicator's action to the client", async () => {
    const client = createStubOfflineClient({
      online: true,
      pending: 2,
      updateReady: true,
      unsent: { count: 1, writes: [] },
    });
    render(<OfflineIndicators client={client} />);

    await userEvent.click(screen.getByRole("button", { name: "Try now" }));
    await userEvent.click(screen.getByRole("button", { name: /new version is ready/i }));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(client.replaysRequested()).toBe(1);
    expect(client.updatesApplied()).toBe(1);
    expect(client.dismissals()).toBe(1);
  });
});
