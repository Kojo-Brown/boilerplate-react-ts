import { use, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";
import type { ReportCache } from "@/lib/reportCache";

export interface ReportShellProps {
  cache: ReportCache;
  /** The report's sections, each free to carry a boundary of its own. */
  children?: ReactNode;
  className?: string | undefined;
}

/**
 * The report header, and the frame its sections render into.
 *
 * This is the component that makes the page a *streaming* page rather than a
 * loading page: it suspends on the summary, so everything it contains is
 * gated behind that one request. Which is exactly the trap worth seeing —
 * the sections below are passed in as elements by the caller, and an element
 * is not a render. They do not render, and therefore do not request anything,
 * until this component has resolved and committed.
 *
 * Nesting a boundary around each section fixes what the user *sees* (the
 * header arrives without waiting for the table) and nothing about what the
 * network *does*. Fixing that is a separate move, made somewhere else: the
 * caller prefetches above this boundary, so the section requests are already
 * in flight by the time this shell commits. See `sectionCache.ts`.
 *
 * Usage:
 *   <SectionBoundary name="report" fallback={<ReportShellSkeleton />}>
 *     <ReportShell cache={cache}>{sections}</ReportShell>
 *   </SectionBoundary>
 */
export function ReportShell({ cache, children, className }: ReportShellProps) {
  const summary = use(cache.read("summary"));

  return (
    <section
      data-testid="report-shell"
      className={cn("flex flex-col gap-6", className)}
      aria-labelledby="report-title"
    >
      <header className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
        <h2 id="report-title" className="text-xl font-semibold text-[var(--color-fg)]">
          {summary.title}
        </h2>
        <p className="text-sm text-[var(--color-muted-fg)]">{summary.period}</p>
        <dl className="mt-2 flex flex-wrap gap-8">
          <div className="flex flex-col">
            <dt className="text-xs tracking-wide text-[var(--color-muted-fg)] uppercase">
              Revenue
            </dt>
            <dd data-testid="report-revenue" className="text-lg font-semibold">
              {formatCurrency(summary.totalRevenue)}
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs tracking-wide text-[var(--color-muted-fg)] uppercase">Orders</dt>
            <dd data-testid="report-orders" className="text-lg font-semibold">
              {summary.orderCount.toLocaleString("en-GB")}
            </dd>
          </div>
        </dl>
      </header>
      {children}
    </section>
  );
}

/**
 * The Suspense fallback for {@link ReportShell}.
 *
 * `children` is how a flat layout says what else is gated behind this
 * boundary: with no nested boundaries below, the section skeletons belong in
 * *this* fallback, because they are not going to appear on their own. A nested
 * layout passes nothing and each section brings its own.
 *
 * Announced once via `role="status"`; the bars themselves are decorative and
 * `aria-hidden`, so they do not collide with the accessible names of the
 * controls they stand in for.
 */
export function ReportShellSkeleton({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div
      role="status"
      aria-label="Loading report"
      data-testid="report-shell-skeleton"
      className={cn("flex flex-col gap-6", className)}
    >
      <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
        <Skeleton variant="text" width="50%" />
        <Skeleton variant="text" width="30%" />
        <div className="mt-2 flex gap-8">
          <Skeleton variant="text" width="6rem" />
          <Skeleton variant="text" width="6rem" />
        </div>
      </div>
      {children}
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
