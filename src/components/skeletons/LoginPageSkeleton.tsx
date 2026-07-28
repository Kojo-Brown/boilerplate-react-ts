import { Skeleton } from "@/components/ui/Skeleton";

export function LoginPageSkeleton() {
  return (
    <main
      role="status"
      className="flex min-h-screen flex-col items-center justify-center gap-6 p-8"
      aria-label="Loading login page"
      aria-busy="true"
    >
      <div className="flex w-full max-w-sm flex-col gap-4">
        {/* Heading */}
        <Skeleton variant="text" className="mx-auto mb-2 h-10 w-32" />
        {/* Email field */}
        <div className="flex flex-col gap-1">
          <Skeleton variant="text" className="h-4 w-12" />
          <Skeleton className="h-10 w-full" />
        </div>
        {/* Password field */}
        <div className="flex flex-col gap-1">
          <Skeleton variant="text" className="h-4 w-20" />
          <Skeleton className="h-10 w-full" />
        </div>
        {/* Submit button */}
        <Skeleton className="h-10 w-full" />
        {/* Divider */}
        <Skeleton variant="text" className="mx-auto h-3 w-8" />
        {/* OAuth button */}
        <Skeleton className="h-10 w-full" />
      </div>
    </main>
  );
}
