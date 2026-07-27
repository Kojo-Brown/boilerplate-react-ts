import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface FormFieldProps {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean | undefined;
  children: ReactNode;
  className?: string | undefined;
}

export function FormField({ label, error, hint, required, children, className }: FormFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium leading-none text-[var(--color-fg)]">
          {label}
          {required && (
            <span className="ml-0.5 text-[var(--color-danger)]" aria-hidden="true">
              *
            </span>
          )}
        </span>
        {children}
      </label>
      {hint && !error && <p className="text-xs text-[var(--color-muted-fg)]">{hint}</p>}
      {error && (
        <p className="text-xs text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
