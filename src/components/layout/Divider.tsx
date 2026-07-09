import { cn } from "@/lib/cn";

interface DividerProps {
  /** Layout axis of the divider */
  orientation?: "horizontal" | "vertical";
  /** Optional text label centered on a horizontal divider */
  label?: string;
  /** When true, the element is hidden from assistive technology */
  decorative?: boolean;
  className?: string;
}

export function Divider({
  orientation = "horizontal",
  label,
  decorative = true,
  className,
}: DividerProps) {
  const ariaHidden = decorative ? (true as const) : undefined;
  const role = decorative ? undefined : "separator";

  if (orientation === "vertical") {
    return (
      <div
        role={role}
        aria-orientation={decorative ? undefined : "vertical"}
        aria-hidden={ariaHidden}
        className={cn("w-px self-stretch bg-[var(--color-border)]", className)}
      />
    );
  }

  if (label) {
    return (
      <div
        role={role}
        aria-hidden={ariaHidden}
        className={cn("flex items-center gap-3", className)}
      >
        <div className="h-px flex-1 bg-[var(--color-border)]" />
        <span className="select-none text-xs text-[var(--color-fg-subtle)]">{label}</span>
        <div className="h-px flex-1 bg-[var(--color-border)]" />
      </div>
    );
  }

  return (
    <hr
      role={role}
      aria-hidden={ariaHidden}
      className={cn("h-px border-0 bg-[var(--color-border)]", className)}
    />
  );
}
