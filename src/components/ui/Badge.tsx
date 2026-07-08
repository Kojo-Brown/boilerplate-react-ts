import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type BadgeVariant = "default" | "primary" | "success" | "warning" | "danger" | "outline";
type BadgeSize = "sm" | "md";

interface BadgeProps {
  variant?: BadgeVariant;
  size?: BadgeSize;
  children: ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-[var(--color-muted)] text-[var(--color-fg)]",
  primary: "bg-[var(--color-primary)] text-[var(--color-primary-fg)]",
  success: "bg-[var(--color-success)] text-[var(--color-success-fg)]",
  warning: "bg-[var(--color-warning)] text-[var(--color-warning-fg)]",
  danger: "bg-[var(--color-danger)] text-[var(--color-danger-fg)]",
  outline: "border border-[var(--color-border)] bg-transparent text-[var(--color-fg)]",
};

const sizeClasses: Record<BadgeSize, string> = {
  sm: "px-1.5 py-0.5 text-xs",
  md: "px-2 py-0.5 text-xs",
};

export function Badge({ variant = "default", size = "md", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--radius-full)] font-medium",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
    >
      {children}
    </span>
  );
}
