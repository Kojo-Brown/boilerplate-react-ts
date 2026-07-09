import { Skeleton } from "@/components/ui/Skeleton";

export function AboutPageSkeleton() {
  return (
    <main
      className="flex flex-col items-center justify-center gap-6 p-8 py-16"
      aria-label="Loading about page"
      aria-busy="true"
    >
      {/* Title */}
      <Skeleton variant="text" className="h-10 w-36" aria-label="Loading title" />
      {/* Body text */}
      <div className="flex max-w-md flex-col gap-2">
        <Skeleton variant="text" className="h-5 w-full" aria-label="Loading description line 1" />
        <Skeleton variant="text" className="h-5 w-4/5 self-center" aria-label="Loading description line 2" />
      </div>
      {/* Buttons */}
      <div className="flex gap-3">
        <Skeleton className="h-10 w-24" aria-label="Loading primary action" />
        <Skeleton className="h-10 w-28" aria-label="Loading secondary action" />
      </div>
    </main>
  );
}
