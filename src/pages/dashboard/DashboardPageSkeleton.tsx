import { Skeleton } from "@/shared/ui/Skeleton";

export function DashboardPageSkeleton() {
  return (
    <main
      role="status"
      className="flex flex-col gap-6 p-8"
      aria-label="Loading dashboard"
      aria-busy="true"
    >
      {/* Page heading */}
      <Skeleton variant="text" className="h-9 w-48" />

      {/* Stats row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] p-4"
          >
            <Skeleton variant="text" className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>

      {/* Content area */}
      <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] p-6">
        <Skeleton variant="text" className="h-5 w-64" />
        <Skeleton variant="text" className="h-4 w-full" />
        <Skeleton variant="text" className="h-4 w-5/6" />
        <Skeleton variant="text" className="h-4 w-4/6" />
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-10 w-20" />
      </div>
    </main>
  );
}
