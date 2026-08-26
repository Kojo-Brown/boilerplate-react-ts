import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/cn";

type ToastVariant = "default" | "success" | "warning" | "danger";

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  duration: number;
}

type ToastInput = Omit<ToastItem, "id" | "variant" | "duration"> & {
  variant?: ToastVariant | undefined;
  duration?: number | undefined;
};

interface ToastContextValue {
  toast: (input: ToastInput) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

/**
 * Opted into the React Compiler (see `docs/react-compiler.md`).
 *
 * This provider is the clearest argument in the codebase for the compiler over
 * hand-memoization. `toast` and `dismiss` were each wrapped in `useCallback`,
 * and the context value was still `{{ toast, dismiss }}` — a fresh object on
 * every render. The stable callbacks bought nothing at the boundary that
 * mattered, because the object holding them was new each time and that is what
 * consumers compare. Two correct-looking `useCallback`s, zero effect.
 *
 * The compiler memoizes the object literal along with the functions, so the
 * value is now genuinely stable. `Toast.test.tsx` asserts that.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  "use memo";

  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = (id: string): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const toast = ({ variant = "default", duration = 4000, ...input }: ToastInput): void => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, variant, duration, ...input }]);
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  };

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      {createPortal(
        <div
          role="region"
          aria-label="Notifications"
          aria-live="polite"
          className="fixed right-4 bottom-4 z-[1500] flex flex-col gap-2"
        >
          {toasts.map((t) => (
            <ToastCard key={t.id} item={t} onDismiss={dismiss} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

const variantClasses: Record<ToastVariant, string> = {
  default: "bg-[var(--color-surface)] border-[var(--color-border)]",
  success: "bg-[var(--color-success-subtle)] border-[var(--color-success)]",
  warning: "bg-[var(--color-warning-subtle)] border-[var(--color-warning)]",
  danger: "bg-[var(--color-danger-subtle)] border-[var(--color-danger)]",
};

function ToastIcon({ variant }: { variant: ToastVariant }) {
  if (variant === "success") {
    return (
      <svg
        className="h-4 w-4 shrink-0 text-[var(--color-success)]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M20 6L9 17l-5-5" />
      </svg>
    );
  }
  if (variant === "warning") {
    return (
      <svg
        className="h-4 w-4 shrink-0 text-[var(--color-warning)]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" />
      </svg>
    );
  }
  if (variant === "danger") {
    return (
      <svg
        className="h-4 w-4 shrink-0 text-[var(--color-danger)]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M15 9l-6 6M9 9l6 6" />
      </svg>
    );
  }
  return null;
}

interface ToastCardProps {
  item: ToastItem;
  onDismiss: (id: string) => void;
}

function ToastCard({ item, onDismiss }: ToastCardProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex w-80 items-start gap-3 rounded-[var(--radius-lg)] border p-4 shadow-[var(--shadow-lg)]",
        variantClasses[item.variant],
      )}
    >
      <ToastIcon variant={item.variant} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--color-fg)]">{item.title}</p>
        {item.description && (
          <p className="mt-1 text-xs text-[var(--color-muted-fg)]">{item.description}</p>
        )}
      </div>
      <button
        onClick={() => {
          onDismiss(item.id);
        }}
        className="shrink-0 text-[var(--color-muted-fg)] transition-colors hover:text-[var(--color-fg)]"
        aria-label="Dismiss notification"
      >
        <svg
          width="14"
          height="14"
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
  );
}
