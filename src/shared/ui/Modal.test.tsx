import { useRef } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "@/shared/ui/Modal";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  });
});

function renderModal(props: Partial<Parameters<typeof Modal>[0]> = {}) {
  const onClose = vi.fn();
  return {
    onClose,
    ...render(
      <Modal open={true} onClose={onClose} title="Test Modal" {...props}>
        <p>Modal content</p>
      </Modal>,
    ),
  };
}

describe("Modal", () => {
  it("renders title", () => {
    renderModal();
    expect(screen.getByText("Test Modal")).toBeInTheDocument();
  });

  it("renders children", () => {
    renderModal();
    expect(screen.getByText("Modal content")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    renderModal({ description: "A helpful description" });
    expect(screen.getByText("A helpful description")).toBeInTheDocument();
  });

  it("does not render description when omitted", () => {
    renderModal();
    expect(screen.queryByText("A helpful description")).not.toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls showModal when open becomes true", () => {
    renderModal({ open: true });
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });

  it("calls close when open becomes false", () => {
    const { rerender } = render(
      <Modal open={true} onClose={vi.fn()} title="Test">
        content
      </Modal>,
    );
    rerender(
      <Modal open={false} onClose={vi.fn()} title="Test">
        content
      </Modal>,
    );
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
  });

  describe("the keyboard contract", () => {
    /*
     * Most of it belongs to `showModal()` rather than to this component — the
     * Tab trap, Escape, focus restored on close, the document behind made
     * inert — and jsdom implements none of it (the `beforeEach` above stubs
     * `showModal` into an attribute change). Those claims are checked against
     * a real browser in `e2e/keyboard-patterns.spec.ts`. What is left here is
     * the part the platform has no opinion about and this file decides.
     */

    it("starts focus on the title rather than on the close button", () => {
      renderModal({ description: "A helpful description" });

      /*
       * `showModal()` focuses the first focusable element, which for every
       * dialog with a close button in its header is the close button — so a
       * screen-reader user is told "Close dialog, button" and the title and
       * description they were opened for go unread.
       */
      expect(screen.getByRole("heading", { name: "Test Modal" })).toHaveFocus();
    });

    it("keeps the title out of the tab order it is focusable in", () => {
      renderModal();
      expect(screen.getByRole("heading", { name: "Test Modal" })).toHaveAttribute("tabindex", "-1");
    });

    it("honours initialFocusRef when the dialog has a first action", () => {
      function WithInput() {
        const inputRef = useRef<HTMLInputElement>(null);
        return (
          <Modal open onClose={vi.fn()} title="Rename" initialFocusRef={inputRef}>
            <input ref={inputRef} aria-label="New name" />
          </Modal>
        );
      }
      render(<WithInput />);

      expect(screen.getByRole("textbox", { name: "New name" })).toHaveFocus();
    });

    it("gives every instance its own label and description ids", () => {
      render(
        <>
          <Modal open onClose={vi.fn()} title="First dialog" description="First description">
            one
          </Modal>
          <Modal open onClose={vi.fn()} title="Second dialog" description="Second description">
            two
          </Modal>
        </>,
      );

      /*
       * Both dialogs used to carry `id="modal-title"`. An `aria-labelledby`
       * pointing at a duplicated id resolves to whichever comes first in the
       * document, so the second dialog announced the first one's title — and
       * nothing about that is visible in a screenshot.
       */
      const [first, second] = screen.getAllByRole("dialog", { hidden: true });
      expect(first).toHaveAccessibleName("First dialog");
      expect(second).toHaveAccessibleName("Second dialog");
      expect(first).toHaveAccessibleDescription("First description");
      expect(second).toHaveAccessibleDescription("Second description");
    });
  });
});
