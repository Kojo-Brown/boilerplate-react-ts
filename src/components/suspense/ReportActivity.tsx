import { use } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";
import type { ReportCache } from "@/lib/reportCache";

export interface ReportActivityProps {
  cache: ReportCache;
  className?: string | undefined;
}

/**
 * Recent activity — the quick section, and the one that makes reveal order
 * visible.
 *
 * It sits *after* the breakdown in the markup and resolves *before* it, so
 * with a boundary each it appears first. Sibling boundaries reveal in
 * completion order, not source order; React has no stable API for holding a
 * fast section back until a slower one above it is ready (`<SuspenseList>` is
 * still experimental and not exported from `react`). If a page needs a fixed
 * reveal order, that has to come from putting the sections in one boundary and
 * accepting that they wait for each other.
 */
export function ReportActivity({ cache, className }: ReportActivityProps) {
  const entries = use(cache.read("activity"));

  return (
    <section
      data-testid="report-activity"
      aria-labelledby="activity-title"
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4",
        className,
      )}
    >
      <h3 id="activity-title" className="text-base font-semibold text-[var(--color-fg)]">
        Recent activity
      </h3>
      <ul className="flex flex-col gap-2 text-sm">
        {entries.map((entry) => (
          <li key={entry.id} className="flex gap-3">
            <time className="text-[var(--color-muted-fg)] tabular-nums" dateTime={entry.at}>
              {entry.at}
            </time>
            <span>{entry.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The Suspense fallback for {@link ReportActivity}. */
export function ReportActivitySkeleton({ className }: { className?: string | undefined }) {
  return (
    <div
      role="status"
      aria-label="Loading recent activity"
      data-testid="report-activity-skeleton"
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4",
        className,
      )}
    >
      <Skeleton variant="text" width="35%" />
      <Skeleton variant="text" width="90%" />
      <Skeleton variant="text" width="80%" />
    </div>
  );
}
