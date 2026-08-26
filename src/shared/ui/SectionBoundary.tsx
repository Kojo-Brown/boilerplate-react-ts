import { Suspense, type ReactNode } from "react";
import { Button } from "@/shared/ui/Button";
import { ErrorBoundary } from "@/shared/ui/ErrorBoundary";
import { cn } from "@/shared/lib/cn";

export interface SectionBoundaryProps {
  /** Section name, used for the error copy and as a test hook. */
  name: string;
  /** Shown while the section's data is in flight. */
  fallback: ReactNode;
  /**
   * Invalidate this section's cache entries.
   *
   * Called *before* the error boundary resets. The cache keeps rejected
   * promises deliberately (see `promiseCache.ts`), so a bare reset re-reads
   * the same rejected promise and rethrows the same error in the same frame —
   * a "Try again" button that visibly does nothing.
   */
  onRetry?: (() => void) | undefined;
  children: ReactNode;
}

/**
 * One streaming boundary: a Suspense boundary and the error boundary that has
 * to be outside it.
 *
 * The pairing is not a convenience. A component that reads data with `use()`
 * communicates entirely by throwing — a pending promise suspends to the
 * nearest `<Suspense>`, a rejected one throws to the nearest error boundary —
 * so both are required, and the error boundary must be the outer of the two or
 * a rejection unmounts the boundary that was supposed to catch it.
 *
 * What this component makes cheap is *having more of them*. Every boundary is
 * a decision about two things at once:
 *
 * - **Reveal granularity.** Everything inside one boundary appears together,
 *   when the slowest thing inside it is ready. Splitting a page into three
 *   boundaries is what turns one long blank into three independent reveals.
 * - **Blast radius.** Everything inside one boundary fails together. A section
 *   with its own boundary can error while its siblings stay on screen.
 *
 * There is a third effect that is easy to miss, because it is about the
 * network rather than the screen: a boundary is a **fence around a
 * suspension**. When a component suspends, the render pass it was part of is
 * abandoned, and the siblings after it never render — so they never start
 * their requests either. Giving each sibling its own boundary contains that,
 * and their requests go out together instead of one after another. This is
 * measured in `StreamingReport.test.tsx` rather than assumed.
 *
 * What a boundary still cannot do is start anything before the boundary
 * *above* it has resolved. Only prefetching crosses that line — see
 * `sectionCache.ts`, and `docs/suspense-streaming.md` for both axes together.
 *
 * Usage:
 *   <SectionBoundary name="breakdown" fallback={<BreakdownSkeleton />} onRetry={retry}>
 *     <ReportBreakdown cache={cache} />
 *   </SectionBoundary>
 */
export function SectionBoundary({ name, fallback, onRetry, children }: SectionBoundaryProps) {
  return (
    <ErrorBoundary
      fallback={({ error, reset }) => (
        <div
          role="alert"
          data-testid="section-error"
          data-section={name}
          className={cn(
            "flex flex-col items-start gap-3 rounded-[var(--radius-lg)] p-4",
            "border border-[var(--color-danger)] text-sm text-[var(--color-fg)]",
          )}
        >
          <span>
            <strong className="font-semibold">Could not load {name}.</strong> {error.message}
          </span>
          <Button
            size="sm"
            variant="secondary"
            data-testid="retry-section"
            data-section={name}
            onClick={() => {
              // Invalidate before reset — see the note on `onRetry`.
              onRetry?.();
              reset();
            }}
          >
            Try again
          </Button>
        </div>
      )}
    >
      <Suspense fallback={fallback}>{children}</Suspense>
    </ErrorBoundary>
  );
}
