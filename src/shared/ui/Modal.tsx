import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/cn";

type ModalSize = "sm" | "md" | "lg" | "xl";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  size?: ModalSize;
  /**
   * What gets focus when the dialog opens.
   *
   * Left unset, focus goes to the dialog's own heading region — see the effect
   * below. Point it at something when the dialog has one obvious first action
   * (a search field, a "name this" input). Never point it at a destructive
   * button: opening a "Delete everything?" dialog with focus on Delete means
   * the Enter key that opened it can confirm it.
   */
  initialFocusRef?: RefObject<HTMLElement | null> | undefined;
  className?: string;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
};

/**
 * A modal dialog over the native `<dialog>` element, opened with
 * `showModal()`.
 *
 * Almost all of the keyboard contract is the platform's rather than this
 * file's, and that is the reason for the element: `showModal()` gives a focus
 * trap that cannot be escaped by Tab, an Escape key that closes, focus
 * restored to whatever opened the dialog, the rest of the document made inert,
 * and the top layer — six behaviours that a `<div role="dialog">` has to
 * reimplement, and that the reimplementation gets wrong in a different way
 * every time. `useFocusTrap` exists in this repository for the one case that
 * cannot be a `<dialog>` (the sidebar, which is a drawer on a phone and a
 * landmark on a desktop, and `showModal()` has no conditional form); it is
 * deliberately not used here, because layering a second trap on the native one
 * puts two listeners in a race after every keydown.
 *
 * What is left for this component is the part the platform has no opinion
 * about: *where* focus lands inside the dialog once it is open.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
  initialFocusRef,
  className,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  /*
   * Ids are per-instance rather than the constants they used to be.
   *
   * Two `<Modal>`s mounted at once — which `open` makes easy, since a closed
   * one is still in the document — both carried `id="modal-title"`, and an
   * `aria-labelledby` pointing at a duplicated id resolves to whichever comes
   * first in the document. So a dialog could announce another dialog's title,
   * and the only visible symptom was a screen reader saying the wrong thing.
   */
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      dialog.showModal();
    } else {
      dialog.close();
    }
  }, [open]);

  /**
   * Where focus starts.
   *
   * `showModal()` does place focus, and what it places it on is the first
   * focusable element in the dialog — which, for every dialog with a close
   * button in its header, is the close button. A screen-reader user then opens
   * a dialog and is told "Close dialog, button", with the title and the
   * description they were supposed to hear sitting above them, unread and now
   * behind a reverse-navigation they have no reason to attempt.
   *
   * So focus goes to the heading instead, which is `tabIndex={-1}`:
   * programmatically focusable, never a tab stop, and therefore invisible to
   * the Tab order this does not otherwise touch. The first Tab from there
   * lands on the close button exactly as before.
   *
   * A layout effect would be the instinct, to move focus in the same frame as
   * `showModal()`. It is the wrong one: `showModal()` itself runs in the
   * passive effect above, and a layout effect would fire first and focus an
   * element in a dialog that is not open yet, which does nothing at all.
   */
  useEffect(() => {
    if (!open) return;
    const target = initialFocusRef?.current ?? headingRef.current;
    target?.focus();
  }, [open, initialFocusRef]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    /*
     * The `close` event, not a keydown handler for Escape.
     *
     * Escape on a `<dialog>` closes it natively, so a component that only
     * listened for the key would have to cancel the platform's close to stay
     * in charge of it — and would still miss `dialog.close()` called from
     * anywhere else. Listening to the event the platform fires means every
     * route to "this dialog is now shut" reports back through one path.
     */
    const handleClose = () => {
      onClose();
    };
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("close", handleClose);
    };
  }, [onClose]);

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        "m-auto w-full rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-0",
        "shadow-[var(--shadow-xl)] outline-none",
        "backdrop:bg-black/50 backdrop:backdrop-blur-sm",
        sizeClasses[size],
        className,
      )}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="flex flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] p-5">
          <div>
            <h2
              ref={headingRef}
              id={titleId}
              // Focusable only on purpose, never by Tab — see the effect above.
              tabIndex={-1}
              className="text-base font-semibold text-[var(--color-fg)] outline-none"
            >
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-[var(--color-muted-fg)]">
                {description}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-[var(--color-muted-fg)] transition-colors hover:text-[var(--color-fg)]"
            aria-label="Close dialog"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </dialog>,
    document.body,
  );
}
