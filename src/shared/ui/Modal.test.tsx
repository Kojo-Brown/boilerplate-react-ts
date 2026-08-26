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
});
