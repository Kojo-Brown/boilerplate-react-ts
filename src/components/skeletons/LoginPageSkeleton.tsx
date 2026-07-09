import { Skeleton } from "@/components/ui/Skeleton";

export function LoginPageSkeleton() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-6 p-8"
      aria-label="Loading login page"
      aria-busy="true"
    >
      <div className="flex w-full max-w-sm flex-col gap-4">
        {/* Heading */}
        <Skeleton variant="text" className="mx-auto mb-2 h-10 w-32" aria-label="Loading heading" />
        {/* Email field */}
        <div className="flex flex-col gap-1">
          <Skeleton variant="text" className="h-4 w-12" aria-label="Loading email label" />
          <Skeleton className="h-10 w-full" aria-label="Loading email input" />
        </div>
        {/* Password field */}
        <div className="flex flex-col gap-1">
          <Skeleton variant="text" className="h-4 w-20" aria-label="Loading password label" />
          <Skeleton className="h-10 w-full" aria-label="Loading password input" />
        </div>
        {/* Submit button */}
        <Skeleton className="h-10 w-full" aria-label="Loading submit button" />
        {/* Divider */}
        <Skeleton variant="text" className="mx-auto h-3 w-8" aria-label="Loading divider" />
        {/* OAuth button */}
        <Skeleton className="h-10 w-full" aria-label="Loading Google sign-in button" />
      </div>
    </main>
  );
}
