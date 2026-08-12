import type { ReactNode } from "react";
import { SectionBoundary } from "@/components/suspense/SectionBoundary";
import { ReportShell, ReportShellSkeleton } from "@/components/suspense/ReportShell";
import { ReportBreakdown, ReportBreakdownSkeleton } from "@/components/suspense/ReportBreakdown";
import { ReportActivity, ReportActivitySkeleton } from "@/components/suspense/ReportActivity";
import { REPORT_SECTIONS } from "@/lib/reportApi";
import type { ReportCache } from "@/lib/reportCache";

/** Where the boundaries go. */
export type BoundaryLayout =
  /** One boundary per section, inside the shell's. Progressive reveal. */
  | "nested"
  /** A single boundary around the whole report. All-or-nothing. */
  | "flat";

/** When the section requests start. */
export type LoadingStrategy =
  /** Prefetched above the shell's boundary, so all three run together. */
  | "parallel"
  /** Started by the section components themselves, i.e. after the shell. */
  | "waterfall";

export interface StreamingReportProps {
  cache: ReportCache;
  boundaries: BoundaryLayout;
  loading: LoadingStrategy;
  className?: string | undefined;
}

/**
 * The report, assembled two ways along two independent axes.
 *
 * They are separate knobs, and the interesting part is that they are not
 * separate *concerns*:
 *
 * - **`boundaries`** decides when each piece is displayed. Nested boundaries
 *   reveal the header as soon as the summary lands and each section as its own
 *   data lands; a flat boundary holds the entire page until the slowest
 *   request settles.
 * - **`loading`** decides when each request starts. Prefetching puts all three
 *   in flight at once; leaving each section to start its own means none of
 *   them can begin until the shell has resolved and committed, because an
 *   unrendered component has asked for nothing.
 *
 * Boundary placement also has a second, quieter effect on the network, and the
 * three `waterfall` timelines are the clearest way to see it:
 *
 *   flat:     summary → breakdown → activity     (three round trips, in series)
 *   nested:   summary → breakdown ∥ activity     (two)
 *   parallel: summary ∥ breakdown ∥ activity     (one, either layout)
 *
 * The flat row is the surprise. A suspension abandons the render pass it
 * happened in, so under a single boundary the breakdown suspending means the
 * activity feed never renders — and a component that never rendered has not
 * asked for anything. Its request waits for a request it has no relationship
 * with. Nesting fences each suspension, which is why the middle row costs two
 * round trips rather than three.
 *
 * So `nested` + `waterfall` — nesting the boundaries and calling it done —
 * reveals progressively and still takes summary-then-slowest end to end. It
 * looks responsive and finishes late. `flat` + `parallel` is the mirror image:
 * one long blank, finished as soon as the slowest single request is.
 *
 * The prefetch has to happen here, above the shell's boundary, and not inside
 * `<ReportShell>`: that render is precisely the one being waited on.
 *
 * Usage:
 *   <StreamingReport cache={cache} boundaries="nested" loading="parallel" />
 */
export function StreamingReport({ cache, boundaries, loading, className }: StreamingReportProps) {
  if (loading === "parallel") {
    // Safe during render, and idempotent: `prefetch` goes through the same
    // per-section entry `read` does, so StrictMode's double render — and every
    // re-render after it — starts nothing twice.
    cache.prefetch(...REPORT_SECTIONS);
  }

  const sections: ReactNode = (
    <div className="grid gap-4 lg:grid-cols-2">
      {withBoundary(
        boundaries,
        "breakdown",
        <ReportBreakdownSkeleton />,
        () => cache.invalidate("breakdown"),
        <ReportBreakdown cache={cache} />,
      )}
      {withBoundary(
        boundaries,
        "activity",
        <ReportActivitySkeleton />,
        () => cache.invalidate("activity"),
        <ReportActivity cache={cache} />,
      )}
    </div>
  );

  return (
    <div data-testid="streaming-report" data-boundaries={boundaries} data-loading={loading}>
      <SectionBoundary
        name="report"
        fallback={
          // A flat layout has no nested boundaries to supply section
          // fallbacks, so they belong in this one — otherwise the space where
          // the sections will be is simply empty until everything lands.
          <ReportShellSkeleton className={className}>
            {boundaries === "flat" ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <ReportBreakdownSkeleton />
                <ReportActivitySkeleton />
              </div>
            ) : null}
          </ReportShellSkeleton>
        }
        onRetry={() => {
          cache.invalidate("summary");
          // A flat boundary catches its sections' failures too, so its retry
          // has to clear whatever it is standing in front of.
          if (boundaries === "flat") {
            cache.invalidate("breakdown");
            cache.invalidate("activity");
          }
        }}
      >
        <ReportShell cache={cache} className={className}>
          {sections}
        </ReportShell>
      </SectionBoundary>
    </div>
  );
}

/**
 * Wraps a section in its own boundary, or leaves it bare for the flat layout.
 *
 * The two layouts render the *same* section components against the *same*
 * cache — only the boundary around them differs. Anything else varying would
 * make a comparison between the layouts meaningless.
 */
function withBoundary(
  layout: BoundaryLayout,
  name: string,
  fallback: ReactNode,
  onRetry: () => void,
  children: ReactNode,
): ReactNode {
  if (layout === "flat") return children;
  return (
    <SectionBoundary name={name} fallback={fallback} onRetry={onRetry}>
      {children}
    </SectionBoundary>
  );
}
