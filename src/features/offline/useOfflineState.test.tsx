import { describe, it, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useOfflineState } from "@/features/offline/useOfflineState";
import { createStubOfflineClient } from "@/test/offlineState";
import type { OfflineClient } from "@/shared/offline/offlineClient";

function Probe({ client }: { client: OfflineClient }) {
  const { online, pending, updateReady } = useOfflineState(client);
  return (
    <output>{`${online ? "online" : "offline"} ${pending} ${updateReady ? "update" : "current"}`}</output>
  );
}

describe("useOfflineState", () => {
  it("renders the state that already exists on first paint", () => {
    // The point of `useSyncExternalStore` here: the browser can be offline and
    // the worker can be holding writes from a previous visit before React has
    // rendered anything. An effect-based hook would paint "online, nothing
    // pending" first and correct itself a frame later.
    const client = createStubOfflineClient({ online: false, pending: 2 });
    render(<Probe client={client} />);
    expect(screen.getByRole("status")).toHaveTextContent("offline 2 current");
  });

  it("re-renders when the client publishes a change", () => {
    const client = createStubOfflineClient();
    render(<Probe client={client} />);
    expect(screen.getByRole("status")).toHaveTextContent("online 0 current");

    act(() => {
      client.set({ online: false, pending: 1 });
    });
    expect(screen.getByRole("status")).toHaveTextContent("offline 1 current");

    act(() => {
      client.set({ updateReady: true });
    });
    expect(screen.getByRole("status")).toHaveTextContent("offline 1 update");
  });

  it("stops listening when the component unmounts", () => {
    const client = createStubOfflineClient();
    const { unmount } = render(<Probe client={client} />);
    expect(client.listenerCount()).toBe(1);

    unmount();

    // A store subscription that outlives its component is a leak that only
    // shows up after enough navigations — `docs/memory-leaks.md` is the method
    // for finding those, and this is the cheap half of it.
    expect(client.listenerCount()).toBe(0);
  });
});
