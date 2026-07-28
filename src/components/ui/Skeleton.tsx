import { cn } from "@/lib/cn";

type SkeletonVariant = "rect" | "text" | "circle";

interface SkeletonProps {
  variant?: SkeletonVariant;
  className?: string;
  width?: string;
  height?: string;
}

/**
 * A single placeholder bar. Decorative by design: the page-level skeleton
 * announces loading once via `role="status"`, so individual bars are hidden
 * from the accessibility tree. Per-bar labels would flood screen readers and
 * collide with the accessible names of the real controls they stand in for.
 */
export function Skeleton({ variant = "rect", className, width, height }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      style={{ width, height }}
      className={cn(
        "animate-pulse bg-[var(--color-muted)]",
        variant === "circle" && "rounded-full",
        variant === "text" && "h-4 rounded",
        variant === "rect" && "rounded-md",
        className,
      )}
    />
  );
}
