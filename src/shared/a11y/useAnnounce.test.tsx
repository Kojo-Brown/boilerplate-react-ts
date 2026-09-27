import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useAnnounce } from "@/shared/a11y/useAnnounce";
import { createAnnouncerHarness, type AnnouncerHarness } from "@/test/announcer";
import type { Announcer } from "@/shared/a11y/announcer";

const GAP_MS = 10;

function Speaker({ announcer, message }: { announcer: Announcer; message: string }) {
  const announce = useAnnounce(announcer);
  return (
    <button
      onClick={() => {
        announce(message);
      }}
    >
      Say
    </button>
  );
}

describe("useAnnounce", () => {
  let harness: AnnouncerHarness;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createAnnouncerHarness({ gapMs: GAP_MS });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("announces through the announcer it is given", () => {
    const { getByRole } = render(<Speaker announcer={harness.announcer} message="saved" />);

    act(() => {
      getByRole("button").click();
    });

    expect(harness.texts()).toEqual(["saved"]);
  });

  it("returns the same function across re-renders", () => {
    const seen: unknown[] = [];
    function Consumer() {
      seen.push(useAnnounce(harness.announcer));
      return null;
    }
    const { rerender } = render(<Consumer />);
    rerender(<Consumer />);
    rerender(<Consumer />);

    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(1);
  });

  it("withdraws what it queued and has not spoken when it unmounts", () => {
    function Pair() {
      const announce = useAnnounce(harness.announcer);
      return (
        <button
          onClick={() => {
            announce("first");
            announce("second");
          }}
        >
          Say both
        </button>
      );
    }

    const { getByRole, unmount } = render(<Pair />);
    act(() => {
      getByRole("button").click();
    });
    expect(harness.texts()).toEqual(["first"]);

    unmount();
    act(() => {
      vi.advanceTimersByTime(GAP_MS * 3);
    });

    // "second" never happened: the component describing it is gone, and speaking
    // it now would describe this page to whoever is on the next one.
    expect(harness.texts()).toEqual(["first"]);
  });

  it("does not silence a sibling instance of the same component", () => {
    function Harness({ showFirst }: { showFirst: boolean }) {
      return (
        <>
          {showFirst ? <Speaker announcer={harness.announcer} message="from the first" /> : null}
          <Speaker announcer={harness.announcer} message="from the second" />
        </>
      );
    }

    const { getAllByRole, rerender } = render(<Harness showFirst />);
    act(() => {
      for (const button of getAllByRole("button")) button.click();
    });
    expect(harness.texts()).toEqual(["from the first"]);

    // Unmounting one instance must not retract the other's queued message. A
    // string owner key shared by every instance of a component would.
    rerender(<Harness showFirst={false} />);
    act(() => {
      vi.advanceTimersByTime(GAP_MS * 2);
    });

    expect(harness.texts()).toEqual(["from the first", "from the second"]);
  });
});
