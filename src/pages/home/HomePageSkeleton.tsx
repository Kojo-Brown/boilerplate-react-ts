import { Skeleton } from "@/shared/ui/Skeleton";

export function HomePageSkeleton() {
  return (
    <main
      role="status"
      className="flex flex-col items-center justify-center gap-6 p-8 py-16"
      aria-label="Loading home page"
      aria-busy="true"
    >
      {/* Title */}
      <Skeleton variant="text" className="h-10 w-80" />
      {/* Subtitle */}
      <Skeleton variant="text" className="h-5 w-96 max-w-full" />
      {/* CTA buttons */}
      <div className="flex gap-3">
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-10 w-20" />
      </div>
    </main>
  );
}
