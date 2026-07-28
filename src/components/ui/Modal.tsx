import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

type ModalSize = "sm" | "md" | "lg" | "xl";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  size?: ModalSize;
  className?: string;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
  className,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      dialog.showModal();
    } else {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
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
      aria-labelledby="modal-title"
      aria-describedby={description ? "modal-description" : undefined}
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
            <h2 id="modal-title" className="text-base font-semibold text-[var(--color-fg)]">
              {title}
            </h2>
            {description && (
              <p id="modal-description" className="mt-1 text-sm text-[var(--color-muted-fg)]">
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
