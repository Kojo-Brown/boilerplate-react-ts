import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

type StackDirection = "row" | "col";
type GapSize = "none" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
type AlignItems = "start" | "center" | "end" | "stretch" | "baseline";
type JustifyContent = "start" | "center" | "end" | "between" | "around" | "evenly";

const directionClasses: Record<StackDirection, string> = {
  row: "flex-row",
  col: "flex-col",
};

const gapClasses: Record<GapSize, string> = {
  none: "gap-0",
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
  xl: "gap-8",
  "2xl": "gap-12",
};

const alignClasses: Record<AlignItems, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
  baseline: "items-baseline",
};

const justifyClasses: Record<JustifyContent, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
  around: "justify-around",
  evenly: "justify-evenly",
};

interface StackProps extends HTMLAttributes<HTMLDivElement> {
  /** Main axis direction */
  direction?: StackDirection;
  /** Space between children */
  gap?: GapSize;
  /** Cross-axis alignment (align-items) */
  align?: AlignItems;
  /** Main-axis distribution (justify-content) */
  justify?: JustifyContent;
  /** Allow children to wrap onto multiple lines */
  wrap?: boolean;
  children?: ReactNode;
}

export function Stack({
  direction = "col",
  gap = "md",
  align = "stretch",
  justify = "start",
  wrap = false,
  className,
  children,
  ...rest
}: StackProps) {
  return (
    <div
      className={cn(
        "flex",
        directionClasses[direction],
        gapClasses[gap],
        alignClasses[align],
        justifyClasses[justify],
        wrap && "flex-wrap",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
