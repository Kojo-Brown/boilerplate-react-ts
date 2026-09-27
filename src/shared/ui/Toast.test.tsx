import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactElement } from "react";
import { ToastProvider, useToast } from "@/shared/ui/Toast";
import { createAnnouncerHarness, type AnnouncerHarness } from "@/test/announcer";
import type { Politeness } from "@/shared/a11y/announcer";

function ToastTrigger({
  title,
  variant,
}: {
  title: string;
  variant?: "success" | "danger" | undefined;
}) {
  const { toast } = useToast();
  return (
    <button
      onClick={() => {
        toast({ title, variant });
      }}
    >
      Show Toast
    </button>
  );
}

function renderWithProvider(ui: ReactElement): RenderResult {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("ToastProvider / useToast", () => {
  // Without this, a test that fails before its own `useRealTimers()` leaves the
  // fake clock installed and every later test hangs waiting on it.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws when useToast is used outside provider", () => {
    const ConsumerWithoutProvider = () => {
      useToast();
      return null;
    };
    expect(() => render(<ConsumerWithoutProvider />)).toThrow(
      "useToast must be used within <ToastProvider>",
    );
  });

  it("shows a toast after calling toast()", async () => {
    const user = userEvent.setup();
    renderWithProvider(<ToastTrigger title="Hello World" />);
    await user.click(screen.getByRole("button", { name: "Show Toast" }));
    expect(screen.getByTestId("toast")).toBeInTheDocument();
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("shows toast with description", async () => {
    const user = userEvent.setup();
    function TriggerWithDesc() {
      const { toast } = useToast();
      return (
        <button
          onClick={() => {
            toast({ title: "Title", description: "Details here" });
          }}
        >
          Show
        </button>
      );
    }
    renderWithProvider(<TriggerWithDesc />);
    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByText("Details here")).toBeInTheDocument();
  });

  it("dismisses toast when dismiss button is clicked", async () => {
    const user = userEvent.setup();
    renderWithProvider(<ToastTrigger title="Dismiss me" />);
    await user.click(screen.getByRole("button", { name: "Show Toast" }));
    expect(screen.getByTestId("toast")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByTestId("toast")).not.toBeInTheDocument();
  });

  it("auto-dismisses after duration", () => {
    vi.useFakeTimers();
    function AutoDismissTrigger() {
      const { toast } = useToast();
      return (
        <button
          onClick={() => {
            toast({ title: "Auto gone", duration: 1000 });
          }}
        >
          Show
        </button>
      );
    }
    renderWithProvider(<AutoDismissTrigger />);

    // `fireEvent` rather than `userEvent`: userEvent awaits its own internal
    // delay timers, which deadlocks against Vitest's fake clock here.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Show" }));
    });
    expect(screen.getByTestId("toast")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1001);
    });
    expect(screen.queryByTestId("toast")).not.toBeInTheDocument();
  });

  it("shows multiple toasts", async () => {
    const user = userEvent.setup();
    function MultiTrigger() {
      const { toast } = useToast();
      return (
        <>
          <button
            onClick={() => {
              toast({ title: "First" });
            }}
          >
            First
          </button>
          <button
            onClick={() => {
              toast({ title: "Second" });
            }}
          >
            Second
          </button>
        </>
      );
    }
    renderWithProvider(<MultiTrigger />);
    await user.click(screen.getByRole("button", { name: "First" }));
    await user.click(screen.getByRole("button", { name: "Second" }));
    expect(screen.getAllByTestId("toast")).toHaveLength(2);
  });

  it("renders success variant", async () => {
    const user = userEvent.setup();
    renderWithProvider(<ToastTrigger title="Done" variant="success" />);
    await user.click(screen.getByRole("button", { name: "Show Toast" }));
    expect(screen.getByTestId("toast").className).toContain("bg-[var(--color-success-subtle)]");
  });

  it("renders danger variant", async () => {
    const user = userEvent.setup();
    renderWithProvider(<ToastTrigger title="Error" variant="danger" />);
    await user.click(screen.getByRole("button", { name: "Show Toast" }));
    expect(screen.getByTestId("toast").className).toContain("bg-[var(--color-danger-subtle)]");
  });

  /*
   * The card used to be `role="alert"` inside a container that was
   * `aria-live="polite"` — a live region nested in a live region, where the
   * inner one wins. So the container's politeness applied to nothing and every
   * toast interrupted, "Saved" included. Both attributes are the ones the
   * documentation names, which is why nothing looked wrong.
   */
  describe("announcements", () => {
    function renderWithAnnouncer(ui: ReactElement, harness: AnnouncerHarness): RenderResult {
      return render(<ToastProvider announcer={harness.announcer}>{ui}</ToastProvider>);
    }

    it("is not itself a live region, at either level", async () => {
      const user = userEvent.setup();
      const harness = createAnnouncerHarness();
      renderWithAnnouncer(<ToastTrigger title="Saved" />, harness);
      await user.click(screen.getByRole("button", { name: "Show Toast" }));

      const card = screen.getByTestId("toast");
      expect(card).not.toHaveAttribute("role");
      expect(card).not.toHaveAttribute("aria-live");
      // The container stays a landmark, which is the thing a live region cannot
      // do: let a user navigate back to a message they missed.
      const container = screen.getByRole("region", { name: "Notifications" });
      expect(container).not.toHaveAttribute("aria-live");
    });

    it("announces the toast through the app's live regions", async () => {
      const user = userEvent.setup();
      const harness = createAnnouncerHarness();
      renderWithAnnouncer(<ToastTrigger title="Saved" />, harness);
      await user.click(screen.getByRole("button", { name: "Show Toast" }));

      expect(harness.spoken).toEqual([{ politeness: "polite", text: "Saved" }]);
    });

    it("announces title and description as one message", async () => {
      const user = userEvent.setup();
      const harness = createAnnouncerHarness();
      function Trigger() {
        const { toast } = useToast();
        return (
          <button
            onClick={() => {
              toast({ title: "Upload failed", description: "The file is larger than 10 MB" });
            }}
          >
            Show
          </button>
        );
      }
      renderWithAnnouncer(<Trigger />, harness);
      await user.click(screen.getByRole("button", { name: "Show" }));

      expect(harness.texts()).toEqual(["Upload failed. The file is larger than 10 MB"]);
    });

    it.each<["success" | "danger" | undefined, Politeness]>([
      [undefined, "polite"],
      ["success", "polite"],
      ["danger", "assertive"],
    ])("sends a %s toast to the %s queue", async (variant, politeness) => {
      const user = userEvent.setup();
      const harness = createAnnouncerHarness();
      renderWithAnnouncer(<ToastTrigger title="Notice" variant={variant} />, harness);
      await user.click(screen.getByRole("button", { name: "Show Toast" }));

      expect(harness.spoken).toEqual([{ politeness, text: "Notice" }]);
    });

    it("lets a caller override the politeness its variant implies", async () => {
      const user = userEvent.setup();
      const harness = createAnnouncerHarness();
      function Trigger() {
        const { toast } = useToast();
        return (
          <button
            onClick={() => {
              toast({ title: "Your session expires in a minute", politeness: "assertive" });
            }}
          >
            Show
          </button>
        );
      }
      renderWithAnnouncer(<Trigger />, harness);
      await user.click(screen.getByRole("button", { name: "Show" }));

      expect(harness.texts("assertive")).toEqual(["Your session expires in a minute"]);
    });

    it("keeps the announcement after the toast has auto-dismissed", () => {
      vi.useFakeTimers();
      const harness = createAnnouncerHarness();
      function Trigger() {
        const { toast } = useToast();
        return (
          <button
            onClick={() => {
              toast({ title: "First", duration: 1000 });
              toast({ title: "Second", duration: 1000 });
            }}
          >
            Show
          </button>
        );
      }
      renderWithAnnouncer(<Trigger />, harness);

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Show" }));
      });
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      // Both cards are gone from the document; the second message was still
      // queued when the first card disappeared. A live region *on* the card
      // would have been removed mid-sentence — four seconds is less than a
      // screen reader often needs to reach a message.
      expect(screen.queryByTestId("toast")).not.toBeInTheDocument();
      expect(harness.texts()).toEqual(["First", "Second"]);
    });

    it("clears pending dismissals when the provider unmounts", () => {
      vi.useFakeTimers();
      const harness = createAnnouncerHarness();
      function Trigger() {
        const { toast } = useToast();
        return (
          <button
            onClick={() => {
              toast({ title: "Going", duration: 5000 });
            }}
          >
            Show
          </button>
        );
      }
      const { unmount } = renderWithAnnouncer(<Trigger />, harness);
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Show" }));
      });
      // The announcer has a timer of its own — the gap between two messages —
      // and it is not the subject here, so it is cleared before counting.
      harness.announcer.reset();
      expect(vi.getTimerCount()).toBe(1);

      // Each pending dismissal closes over `setToasts`, so an unmounted provider
      // with toasts in flight kept itself alive for the longest duration and
      // then updated state nobody was rendering.
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  // Before this provider opted into the React Compiler, `toast` and `dismiss`
  // were each wrapped in `useCallback` but handed to consumers inside a fresh
  // `{{ toast, dismiss }}` object literal on every render — so the context
  // value changed identity every time regardless, and the two `useCallback`s
  // achieved nothing at the boundary. The compiler memoizes the object too.
  // This test is what tells the difference; it fails against uncompiled source.
  it("keeps the context value referentially stable across parent re-renders", () => {
    const seen: unknown[] = [];

    function Consumer() {
      seen.push(useToast());
      return null;
    }

    function Harness() {
      const [tick, setTick] = useState(0);
      return (
        <ToastProvider>
          <Consumer />
          <button
            onClick={() => {
              setTick(tick + 1);
            }}
          >
            Re-render {tick}
          </button>
        </ToastProvider>
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Re-render/ }));
    fireEvent.click(screen.getByRole("button", { name: /Re-render/ }));

    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seen).size).toBe(1);
  });
});
