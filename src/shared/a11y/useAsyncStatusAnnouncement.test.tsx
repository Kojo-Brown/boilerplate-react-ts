import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import {
  useAsyncStatusAnnouncement,
  type AsyncStatus,
  type AsyncStatusMessages,
} from "@/shared/a11y/useAsyncStatusAnnouncement";
import { createAnnouncerHarness, type AnnouncerHarness } from "@/test/announcer";

const GAP_MS = 10;
const PENDING_DELAY_MS = 500;

describe("useAsyncStatusAnnouncement", () => {
  let harness: AnnouncerHarness;

  function Panel({ status, messages }: { status: AsyncStatus; messages: AsyncStatusMessages }) {
    useAsyncStatusAnnouncement({
      status,
      messages,
      pendingDelayMs: PENDING_DELAY_MS,
      announcer: harness.announcer,
    });
    return null;
  }

  const messages: AsyncStatusMessages = {
    pending: "Loading posts",
    success: "12 posts",
    error: "Posts could not be loaded",
  };

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createAnnouncerHarness({ gapMs: GAP_MS });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says nothing about the status it mounts with", () => {
    render(<Panel status="success" messages={messages} />);
    act(() => {
      vi.advanceTimersByTime(PENDING_DELAY_MS * 2);
    });

    // A panel arriving with cached data has nothing to report, and on a route
    // change the route announcer has just said where the user is.
    expect(harness.spoken).toEqual([]);
  });

  it("announces a result when the load finishes", () => {
    const { rerender } = render(<Panel status="pending" messages={messages} />);
    rerender(<Panel status="success" messages={messages} />);

    expect(harness.spoken).toEqual([{ politeness: "polite", text: "12 posts" }]);
  });

  it("stays silent about a load that finishes inside the delay", () => {
    const { rerender } = render(<Panel status="success" messages={messages} />);

    rerender(<Panel status="pending" messages={messages} />);
    act(() => {
      vi.advanceTimersByTime(PENDING_DELAY_MS - 1);
    });
    rerender(<Panel status="success" messages={messages} />);
    act(() => {
      vi.advanceTimersByTime(PENDING_DELAY_MS * 2);
    });

    // Not "superseded" — the pending announcement was never made. Otherwise an
    // 80ms refetch costs the user two sentences for one event.
    expect(harness.texts()).toEqual(["12 posts"]);
  });

  it("announces the load once it outlives the delay", () => {
    const { rerender } = render(<Panel status="success" messages={messages} />);

    rerender(<Panel status="pending" messages={messages} />);
    act(() => {
      vi.advanceTimersByTime(PENDING_DELAY_MS);
    });
    expect(harness.texts()).toEqual(["Loading posts"]);

    rerender(<Panel status="success" messages={messages} />);
    act(() => {
      vi.advanceTimersByTime(GAP_MS);
    });
    expect(harness.texts()).toEqual(["Loading posts", "12 posts"]);
  });

  it("reads the pending message as it is when the delay elapses", () => {
    const { rerender } = render(<Panel status="success" messages={messages} />);

    rerender(<Panel status="pending" messages={messages} />);
    rerender(<Panel status="pending" messages={{ ...messages, pending: "Loading page 2" }} />);
    act(() => {
      vi.advanceTimersByTime(PENDING_DELAY_MS);
    });

    expect(harness.texts()).toEqual(["Loading page 2"]);
  });

  it("interrupts for an error and does not for a result", () => {
    const { rerender } = render(<Panel status="pending" messages={messages} />);
    rerender(<Panel status="error" messages={messages} />);

    expect(harness.spoken).toEqual([
      { politeness: "assertive", text: "Posts could not be loaded" },
    ]);
  });

  it("treats a null message as nothing to say", () => {
    const quiet: AsyncStatusMessages = { pending: null, success: null, error: null };
    const { rerender } = render(<Panel status="pending" messages={quiet} />);
    act(() => {
      vi.advanceTimersByTime(PENDING_DELAY_MS);
    });
    rerender(<Panel status="success" messages={quiet} />);

    expect(harness.spoken).toEqual([]);
  });

  it("says nothing for a re-render that does not change the status", () => {
    const { rerender } = render(<Panel status="pending" messages={messages} />);
    rerender(<Panel status="success" messages={messages} />);
    rerender(<Panel status="success" messages={{ ...messages, success: "12 posts, again" }} />);
    act(() => {
      vi.advanceTimersByTime(PENDING_DELAY_MS);
    });

    expect(harness.texts()).toEqual(["12 posts"]);
  });

  it("announces a refetch that fails while showing stale data", () => {
    const { rerender } = render(<Panel status="success" messages={messages} />);
    rerender(<Panel status="error" messages={messages} />);

    // The user is looking at data nothing is keeping up to date any more, which
    // is worth interrupting for even though the screen still has content on it.
    expect(harness.texts("assertive")).toEqual(["Posts could not be loaded"]);
  });

  it("ignores idle", () => {
    const { rerender } = render(<Panel status="success" messages={messages} />);
    rerender(<Panel status="idle" messages={messages} />);
    act(() => {
      vi.advanceTimersByTime(PENDING_DELAY_MS);
    });

    expect(harness.spoken).toEqual([]);
  });

  it("drops a pending announcement the component unmounts before making", () => {
    const { rerender, unmount } = render(<Panel status="success" messages={messages} />);
    rerender(<Panel status="pending" messages={messages} />);
    unmount();
    act(() => {
      vi.advanceTimersByTime(PENDING_DELAY_MS * 2);
    });

    expect(harness.spoken).toEqual([]);
  });
});
