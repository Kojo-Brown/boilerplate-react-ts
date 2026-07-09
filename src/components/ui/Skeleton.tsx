import { cn } from "@/lib/cn";

type SkeletonVariant = "rect" | "text" | "circle";

interface SkeletonProps {
  variant?: SkeletonVariant;
  className?: string;
  width?: string;
  height?: string;
  "aria-label"?: string;
}

export function Skeleton({
  variant = "rect",
  className,
  width,
  height,
  "aria-label": ariaLabel,
}: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label={ariaLabel ?? "Loading…"}
      aria-busy="true"
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
