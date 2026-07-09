import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type ContainerSize = "sm" | "md" | "lg" | "xl" | "2xl" | "full";

const sizeClasses: Record<ContainerSize, string> = {
  sm: "max-w-screen-sm",
  md: "max-w-screen-md",
  lg: "max-w-screen-lg",
  xl: "max-w-screen-xl",
  "2xl": "max-w-screen-2xl",
  full: "max-w-full",
};

interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Constrains the maximum content width */
  size?: ContainerSize;
  children?: ReactNode;
}

export function Container({ size = "xl", className, children, ...rest }: ContainerProps) {
  return (
    <div
      className={cn("mx-auto w-full px-4 sm:px-6 lg:px-8", sizeClasses[size], className)}
      {...rest}
    >
      {children}
    </div>
  );
}
