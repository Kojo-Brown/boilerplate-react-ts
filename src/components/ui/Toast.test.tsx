import { describe, it, expect, vi } from "vitest";
import { render, screen, act, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { ToastProvider, useToast } from "./Toast";

function ToastTrigger({ title, variant }: { title: string; variant?: "success" | "danger" }) {
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
    expect(screen.getByRole("alert")).toBeInTheDocument();
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
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("auto-dismisses after duration", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
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
    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1001);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    vi.useRealTimers();
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
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  it("renders success variant", async () => {
    const user = userEvent.setup();
    renderWithProvider(<ToastTrigger title="Done" variant="success" />);
    await user.click(screen.getByRole("button", { name: "Show Toast" }));
    expect(screen.getByRole("alert").className).toContain("bg-[var(--color-success-subtle)]");
  });

  it("renders danger variant", async () => {
    const user = userEvent.setup();
    renderWithProvider(<ToastTrigger title="Error" variant="danger" />);
    await user.click(screen.getByRole("button", { name: "Show Toast" }));
    expect(screen.getByRole("alert").className).toContain("bg-[var(--color-danger-subtle)]");
  });
});
