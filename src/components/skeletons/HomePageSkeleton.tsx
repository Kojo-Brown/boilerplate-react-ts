import { Skeleton } from "@/components/ui/Skeleton";

export function HomePageSkeleton() {
  return (
    <main
      className="flex flex-col items-center justify-center gap-6 p-8 py-16"
      aria-label="Loading home page"
      aria-busy="true"
    >
      {/* Title */}
      <Skeleton variant="text" className="h-10 w-80" aria-label="Loading title" />
      {/* Subtitle */}
      <Skeleton variant="text" className="h-5 w-96 max-w-full" aria-label="Loading subtitle" />
      {/* CTA buttons */}
      <div className="flex gap-3">
        <Skeleton className="h-10 w-28" aria-label="Loading primary action" />
        <Skeleton className="h-10 w-20" aria-label="Loading secondary action" />
      </div>
    </main>
  );
}
