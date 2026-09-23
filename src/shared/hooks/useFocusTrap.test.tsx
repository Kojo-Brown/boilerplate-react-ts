import { describe, it, expect, vi } from "vitest";
import { useRef, useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useFocusTrap, type FocusTrapOptions } from "@/shared/hooks/useFocusTrap";

interface HarnessProps extends Omit<FocusTrapOptions, "active" | "initialFocus"> {
  readonly startActive?: boolean;
  /** Focus this control instead of the first tabbable one. */
  readonly useInitialFocus?: boolean;
  /** Render no enabled control inside the trap. */
  readonly empty?: boolean;
}

/**
 * An opener outside the trap plus a panel inside it, which is the shape every
 * assertion here needs: a trap is only observable against somewhere focus
 * could otherwise have gone.
 */
function Harness({
  startActive = false,
  useInitialFocus = false,
  empty = false,
  ...options
}: HarnessProps) {
  const [active, setActive] = useState(startActive);
  const secondRef = useRef<HTMLButtonElement>(null);
  const ref = useFocusTrap<HTMLDivElement>({
    active,
    ...options,
    ...(useInitialFocus ? { initialFocus: secondRef } : {}),
  });

  return (
    <div>
      <button
        onClick={() => {
          setActive(true);
        }}
      >
        open
      </button>
      <button>outside</button>
      <div ref={ref} tabIndex={-1} data-testid="panel">
        {empty ? (
          <button disabled>disabled</button>
        ) : (
          <>
            <button>inside one</button>
            <button ref={secondRef}>inside two</button>
          </>
        )}
      </div>
      <button
        onClick={() => {
          setActive(false);
        }}
      >
        close
      </button>
    </div>
  );
}

const button = (name: string) => screen.getByRole("button", { name });

/**
 * A click that is not a user gesture — a backdrop tap, an Escape handler, a
 * parent deciding on its own that the drawer is finished. `act` is what makes
 * the state update it causes flush before the assertion reads focus.
 */
function clickProgrammatically(name: string): void {
  act(() => {
    button(name).click();
  });
}

describe("useFocusTrap", () => {
  it("does nothing while inactive", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.tab();
    expect(document.activeElement).toBe(button("open"));
    await user.tab();
    expect(document.activeElement).toBe(button("outside"));
    await user.tab();
    // Straight into the panel and out the other side: no trap.
    expect(document.activeElement).toBe(button("inside one"));
  });

  it("moves focus to the first tabbable element when it activates", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(button("open"));
    expect(document.activeElement).toBe(button("inside one"));
  });

  it("honours initialFocus over the first tabbable element", async () => {
    const user = userEvent.setup();
    render(<Harness useInitialFocus />);

    await user.click(button("open"));
    expect(document.activeElement).toBe(button("inside two"));
  });

  it("falls back to the container when nothing inside is tabbable", async () => {
    const user = userEvent.setup();
    render(<Harness empty />);

    await user.click(button("open"));
    expect(document.activeElement).toBe(screen.getByTestId("panel"));
  });

  it("wraps Tab from the last element back to the first", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(button("open"));
    await user.tab();
    expect(document.activeElement).toBe(button("inside two"));
    await user.tab();
    expect(document.activeElement).toBe(button("inside one"));
  });

  it("wraps Shift+Tab from the first element back to the last", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(button("open"));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(button("inside two"));
  });

  it("keeps working when a control inside stops keydown propagation", async () => {
    // The capture-phase listener is the whole reason this passes: a bubbling
    // one would never see the event.
    const user = userEvent.setup();
    function Swallower() {
      const ref = useFocusTrap<HTMLDivElement>({ active: true });
      return (
        <div>
          <button>outside</button>
          <div ref={ref} tabIndex={-1}>
            <button
              onKeyDown={(event) => {
                event.stopPropagation();
              }}
            >
              greedy
            </button>
          </div>
        </div>
      );
    }
    render(<Swallower />);

    expect(document.activeElement).toBe(button("greedy"));
    await user.tab();
    expect(document.activeElement).toBe(button("greedy"));
  });

  it("pulls focus back when something outside takes it", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(button("open"));
    // A click on the page behind. `userEvent` focuses the target, which is
    // exactly the escape route Tab interception cannot see.
    await user.click(button("outside"));
    expect(document.activeElement).toBe(button("inside one"));
  });

  it("restores focus to the opener when it deactivates", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(button("open"));
    expect(document.activeElement).toBe(button("inside one"));

    // The close button is outside the trap, so reaching it takes a programmatic
    // click — which is the realistic case anyway: on a drawer, the thing that
    // closes it is usually a backdrop or the Escape key.
    clickProgrammatically("close");
    expect(document.activeElement).toBe(button("open"));
  });

  it("restores focus on unmount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);

    await user.click(button("open"));
    unmount();
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves focus alone when restoreFocus is off", async () => {
    const user = userEvent.setup();
    render(<Harness restoreFocus={false} />);

    await user.click(button("open"));
    clickProgrammatically("close");
    expect(document.activeElement).toBe(button("inside one"));
  });

  it("does not restore focus to an element that has since been removed", () => {
    // Focusing a detached node reads to a screen reader as focus vanishing.
    function Disappearing() {
      const [open, setOpen] = useState(false);
      const ref = useFocusTrap<HTMLDivElement>({ active: open });
      return (
        <div>
          {!open && (
            <button
              onClick={() => {
                setOpen(true);
              }}
            >
              open
            </button>
          )}
          <div ref={ref} tabIndex={-1}>
            <button>inside</button>
          </div>
        </div>
      );
    }
    const { unmount } = render(<Disappearing />);

    clickProgrammatically("open");
    expect(document.activeElement).toBe(button("inside"));
    expect(() => {
      unmount();
    }).not.toThrow();
  });

  it("calls onEscape without preventing the key's other meanings", async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    render(<Harness startActive onEscape={onEscape} />);

    await user.keyboard("{Escape}");
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("does not call a stale onEscape after the prop changes", async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness startActive onEscape={first} />);

    rerender(<Harness startActive onEscape={second} />);
    await user.keyboard("{Escape}");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not rebuild the trap when only onEscape changes identity", async () => {
    // A rebuild would re-run the activation step and yank focus back to the
    // top of the panel on an unrelated parent render.
    const user = userEvent.setup();
    const { rerender } = render(<Harness startActive onEscape={() => undefined} />);

    await user.tab();
    expect(document.activeElement).toBe(button("inside two"));

    rerender(<Harness startActive onEscape={() => undefined} />);
    expect(document.activeElement).toBe(button("inside two"));
  });

  it("releases the document listeners when it deactivates", async () => {
    const user = userEvent.setup();
    const removeSpy = vi.spyOn(document, "removeEventListener");
    render(<Harness />);

    await user.click(button("open"));
    clickProgrammatically("close");

    const removed = removeSpy.mock.calls.map(([type]) => type);
    expect(removed).toContain("keydown");
    expect(removed).toContain("focusin");
    removeSpy.mockRestore();
  });
});
