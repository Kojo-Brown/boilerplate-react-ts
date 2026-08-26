import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

type ColCount = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

type GapSize = "none" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

interface ResponsiveCols {
  base?: ColCount;
  sm?: ColCount;
  md?: ColCount;
  lg?: ColCount;
  xl?: ColCount;
}

type GridCols = ColCount | ResponsiveCols;

const BASE_COLS: Record<ColCount, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
  9: "grid-cols-9",
  10: "grid-cols-10",
  11: "grid-cols-11",
  12: "grid-cols-12",
};

const SM_COLS: Record<ColCount, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
  5: "sm:grid-cols-5",
  6: "sm:grid-cols-6",
  7: "sm:grid-cols-7",
  8: "sm:grid-cols-8",
  9: "sm:grid-cols-9",
  10: "sm:grid-cols-10",
  11: "sm:grid-cols-11",
  12: "sm:grid-cols-12",
};

const MD_COLS: Record<ColCount, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
  5: "md:grid-cols-5",
  6: "md:grid-cols-6",
  7: "md:grid-cols-7",
  8: "md:grid-cols-8",
  9: "md:grid-cols-9",
  10: "md:grid-cols-10",
  11: "md:grid-cols-11",
  12: "md:grid-cols-12",
};

const LG_COLS: Record<ColCount, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
  7: "lg:grid-cols-7",
  8: "lg:grid-cols-8",
  9: "lg:grid-cols-9",
  10: "lg:grid-cols-10",
  11: "lg:grid-cols-11",
  12: "lg:grid-cols-12",
};

const XL_COLS: Record<ColCount, string> = {
  1: "xl:grid-cols-1",
  2: "xl:grid-cols-2",
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
  6: "xl:grid-cols-6",
  7: "xl:grid-cols-7",
  8: "xl:grid-cols-8",
  9: "xl:grid-cols-9",
  10: "xl:grid-cols-10",
  11: "xl:grid-cols-11",
  12: "xl:grid-cols-12",
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

function resolveColClasses(cols: GridCols): string {
  if (typeof cols === "number") return BASE_COLS[cols];
  return cn(
    cols.base !== undefined && BASE_COLS[cols.base],
    cols.sm !== undefined && SM_COLS[cols.sm],
    cols.md !== undefined && MD_COLS[cols.md],
    cols.lg !== undefined && LG_COLS[cols.lg],
    cols.xl !== undefined && XL_COLS[cols.xl],
  );
}

interface GridProps extends HTMLAttributes<HTMLDivElement> {
  /** Number of columns — single value or breakpoint map */
  cols?: GridCols;
  /** Space between grid items */
  gap?: GapSize;
  children?: ReactNode;
}

export function Grid({ cols = 1, gap = "md", className, children, ...rest }: GridProps) {
  return (
    <div className={cn("grid", resolveColClasses(cols), gapClasses[gap], className)} {...rest}>
      {children}
    </div>
  );
}
