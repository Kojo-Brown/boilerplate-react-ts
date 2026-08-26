import type { InputHTMLAttributes, Ref } from "react";
import { cn } from "@/shared/lib/cn";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ error, className, ref, ...props }: InputProps) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)]",
        "bg-[var(--color-bg)] px-3 text-sm text-[var(--color-fg)]",
        "placeholder:text-[var(--color-muted-fg)]",
        "transition-colors",
        "focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-1 focus:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        error && "border-[var(--color-danger)] focus:ring-[var(--color-danger)]",
        className,
      )}
      {...props}
    />
  );
}
