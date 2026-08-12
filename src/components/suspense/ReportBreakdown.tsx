import { use } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";
import type { ReportCache } from "@/lib/reportCache";

export interface ReportBreakdownProps {
  cache: ReportCache;
  className?: string | undefined;
}

/**
 * Revenue by channel — the slow section.
 *
 * Written as if the rows were already there: no loading flag, no `undefined`
 * branch, no early return. That is what a boundary buys, and it is why moving
 * one is a layout change rather than a rewrite of the component underneath.
 *
 * Must be rendered inside a `<SectionBoundary>` (or an equivalent
 * Suspense + error boundary pair): a rejected promise passed to `use()` is
 * rethrown, not returned.
 */
export function ReportBreakdown({ cache, className }: ReportBreakdownProps) {
  const rows = use(cache.read("breakdown"));
  const total = rows.reduce((sum, row) => sum + row.revenue, 0);

  return (
    <section
      data-testid="report-breakdown"
      aria-labelledby="breakdown-title"
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4",
        className,
      )}
    >
      <h3 id="breakdown-title" className="text-base font-semibold text-[var(--color-fg)]">
        Revenue by channel
      </h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[var(--color-muted-fg)]">
            <th scope="col" className="pb-2 font-medium">
              Channel
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Orders
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Revenue
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.channel} className="border-t border-[var(--color-border)]">
              <th scope="row" className="py-2 text-left font-normal">
                {row.channel}
              </th>
              <td className="py-2 text-right tabular-nums">{row.orders.toLocaleString("en-GB")}</td>
              <td className="py-2 text-right tabular-nums">{formatCurrency(row.revenue)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[var(--color-border)] font-semibold">
            <th scope="row" className="py-2 text-left">
              Total
            </th>
            <td />
            <td data-testid="breakdown-total" className="py-2 text-right tabular-nums">
              {formatCurrency(total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

/** The Suspense fallback for {@link ReportBreakdown}. Same box, same rough height. */
export function ReportBreakdownSkeleton({ className }: { className?: string | undefined }) {
  return (
    <div
      role="status"
      aria-label="Loading revenue by channel"
      data-testid="report-breakdown-skeleton"
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4",
        className,
      )}
    >
      <Skeleton variant="text" width="40%" />
      <Skeleton variant="text" width="100%" />
      <Skeleton variant="text" width="100%" />
      <Skeleton variant="text" width="100%" />
      <Skeleton variant="text" width="60%" />
    </div>
  );
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(amount);
}
