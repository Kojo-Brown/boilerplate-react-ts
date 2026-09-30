import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/cn";
import { useAnnounce } from "@/shared/a11y/useAnnounce";
import {
  toastAnnouncement,
  toastPoliteness,
  type ToastVariant,
} from "@/shared/ui/toastAnnouncement";
import type { Announcer, Politeness } from "@/shared/a11y/announcer";

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
  /**
   * Overrides the politeness {@link toastPoliteness} derives from the variant.
   *
   * There for the toast whose urgency is not its colour — a `default` toast
   * saying a session is about to expire interrupts, a `danger` toast summarising
   * a failure the user is already reading about does not.
   */
  politeness?: Politeness | undefined;
};

interface ToastContextValue {
  toast: (input: ToastInput) => void;
  dismiss: (id: string) => void;
}

export interface ToastProviderProps {
  children: ReactNode;
  /** Injected by tests; defaults to the application's announcer. */
  announcer?: Announcer | undefined;
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
export function ToastProvider({ children, announcer }: ToastProviderProps) {
  "use memo";

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const announce = useAnnounce(announcer);
  /*
   * Tracked so unmount can clear them. Each pending dismissal is a closure over
   * `setToasts`, so an unmounted provider with four toasts in flight keeps
   * itself and its state alive for the length of the longest duration — and
   * then updates state nobody is rendering.
   */
  const dismissTimers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = dismissTimers.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const dismiss = (id: string): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const toast = ({
    variant = "default",
    duration = 4000,
    politeness,
    ...input
  }: ToastInput): void => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, variant, duration, ...input }]);
    /*
     * Announced here, from the event that created the toast, rather than by the
     * card that renders it. The card is the wrong place for two reasons, and the
     * second one is the whole reason this item exists: a card mounts *with* its
     * text already in it, which is a new node rather than a mutation and is the
     * one shape reliably not announced; and a card is removed after
     * `duration` ms, taking any speech still queued behind it out of the
     * document. Four seconds is less than a screen reader often needs to reach a
     * message, so the announcement has to outlive the thing announcing.
     */
    announce(toastAnnouncement(input.title, input.description), {
      politeness: politeness ?? toastPoliteness(variant),
    });
    if (duration > 0) {
      const timer = setTimeout(() => {
        dismissTimers.current.delete(timer);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
      dismissTimers.current.add(timer);
    }
  };

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      {createPortal(
        /*
         * Not a live region, and that is a fix rather than an omission.
         *
         * This container declared `aria-live="polite"` while every card inside
         * it declared `role="alert"` — a live region nested in a live region,
         * where the inner one owns its subtree. The container's politeness
         * applied to nothing, and every toast the app could raise, "Saved"
         * included, interrupted the user. Nothing about the markup looked
         * wrong; both attributes are the ones the documentation names.
         *
         * Now the announcement goes through `useAnnounce` and this is what it
         * should have been all along: a labelled landmark a screen-reader user
         * can navigate *to*, holding the toasts that are still on screen. That
         * is worth more than a live region here, because it is the only way to
         * re-read a message the reader spoke while the user was mid-sentence.
         */
        <div
          role="region"
          aria-label="Notifications"
          className="fixed end-4 bottom-4 z-[1500] flex flex-col gap-2"
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

/*
 * The `-strong` variants rather than the bare tokens, because on a toast the
 * colour is never a fill: the panel is painted `*-subtle` and the status hue
 * survives only as the border and the icon. Against that pale background the
 * bare token is a graphic at 2.12:1 for warning — the colour that carries the
 * meaning, failing to be visible at the one thing it is there for.
 */
const variantClasses: Record<ToastVariant, string> = {
  default: "bg-[var(--color-surface)] border-[var(--color-border)]",
  success: "bg-[var(--color-success-subtle)] border-[var(--color-success-strong)]",
  warning: "bg-[var(--color-warning-subtle)] border-[var(--color-warning-strong)]",
  danger: "bg-[var(--color-danger-subtle)] border-[var(--color-danger-strong)]",
};

function ToastIcon({ variant }: { variant: ToastVariant }) {
  if (variant === "success") {
    return (
      <svg
        className="h-4 w-4 shrink-0 text-[var(--color-success-strong)]"
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
        className="h-4 w-4 shrink-0 text-[var(--color-warning-strong)]"
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
        className="h-4 w-4 shrink-0 text-[var(--color-danger-strong)]"
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
    // No role. It was `role="alert"`, which made it the nested live region
    // described on the container above; the announcement is the announcer's job
    // now, and a card that claims a role no longer describes what it is.
    <div
      data-testid="toast"
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
