import { Skeleton } from "@/shared/ui/Skeleton";

export function AboutPageSkeleton() {
  return (
    <main
      role="status"
      className="flex flex-col items-center justify-center gap-6 p-8 py-16"
      aria-label="Loading about page"
      aria-busy="true"
    >
      {/* Title */}
      <Skeleton variant="text" className="h-10 w-36" />
      {/* Body text */}
      <div className="flex max-w-md flex-col gap-2">
        <Skeleton variant="text" className="h-5 w-full" />
        <Skeleton variant="text" className="h-5 w-4/5 self-center" />
      </div>
      {/* Buttons */}
      <div className="flex gap-3">
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-10 w-28" />
      </div>
    </main>
  );
}
