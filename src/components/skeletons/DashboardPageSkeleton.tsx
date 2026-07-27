import { Skeleton } from "@/components/ui/Skeleton";

export function DashboardPageSkeleton() {
  return (
    <main className="flex flex-col gap-6 p-8" aria-label="Loading dashboard" aria-busy="true">
      {/* Page heading */}
      <Skeleton variant="text" className="h-9 w-48" aria-label="Loading heading" />

      {/* Stats row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] p-4"
          >
            <Skeleton
              variant="text"
              className="h-4 w-24"
              aria-label={`Loading stat label ${i + 1}`}
            />
            <Skeleton className="h-8 w-16" aria-label={`Loading stat value ${i + 1}`} />
          </div>
        ))}
      </div>

      {/* Content area */}
      <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] p-6">
        <Skeleton variant="text" className="h-5 w-64" aria-label="Loading content title" />
        <Skeleton variant="text" className="h-4 w-full" aria-label="Loading content line 1" />
        <Skeleton variant="text" className="h-4 w-5/6" aria-label="Loading content line 2" />
        <Skeleton variant="text" className="h-4 w-4/6" aria-label="Loading content line 3" />
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <Skeleton className="h-10 w-24" aria-label="Loading action" />
        <Skeleton className="h-10 w-20" aria-label="Loading secondary action" />
      </div>
    </main>
  );
}
