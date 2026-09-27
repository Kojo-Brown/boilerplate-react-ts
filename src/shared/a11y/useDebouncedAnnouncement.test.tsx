import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useDebouncedAnnouncement } from "@/shared/a11y/useDebouncedAnnouncement";
import { createAnnouncerHarness, type AnnouncerHarness } from "@/test/announcer";

const GAP_MS = 10;
const DEBOUNCE_MS = 400;

describe("useDebouncedAnnouncement", () => {
  let harness: AnnouncerHarness;

  function Filter({ message }: { message: string | null }) {
    useDebouncedAnnouncement(message, {
      delayMs: DEBOUNCE_MS,
      announcer: harness.announcer,
    });
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createAnnouncerHarness({ gapMs: GAP_MS });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not announce the value it mounts with", () => {
    render(<Filter message="8 suggestions available" />);
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    });

    expect(harness.spoken).toEqual([]);
  });

  it("announces once the value stops changing", () => {
    const { rerender } = render(<Filter message="8 suggestions available" />);

    for (const message of [
      "4 suggestions available",
      "2 suggestions available",
      "No suggestions",
    ]) {
      rerender(<Filter message={message} />);
      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS - 1);
      });
    }
    expect(harness.spoken).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(1);
    });

    // One sentence for four keystrokes, and the one that was true at the end.
    expect(harness.texts()).toEqual(["No suggestions"]);
  });

  it("withdraws a waiting announcement when there is nothing left to say", () => {
    const { rerender } = render(<Filter message="8 suggestions available" />);
    rerender(<Filter message="2 suggestions available" />);
    rerender(<Filter message={null} />);
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    });

    expect(harness.spoken).toEqual([]);
  });

  it("honours an assertive override", () => {
    function Urgent({ message }: { message: string | null }) {
      useDebouncedAnnouncement(message, {
        delayMs: DEBOUNCE_MS,
        politeness: "assertive",
        announcer: harness.announcer,
      });
      return null;
    }
    const { rerender } = render(<Urgent message="quiet" />);
    rerender(<Urgent message="loud" />);
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(harness.spoken).toEqual([{ politeness: "assertive", text: "loud" }]);
  });

  it("drops an announcement the component unmounts before making", () => {
    const { rerender, unmount } = render(<Filter message="8 suggestions available" />);
    rerender(<Filter message="No suggestions" />);
    unmount();
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    });

    expect(harness.spoken).toEqual([]);
  });
});
