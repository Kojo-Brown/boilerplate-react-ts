import { Suspense, use } from "react";
import { Button } from "@/shared/ui/Button";
import { ErrorBoundary } from "@/shared/ui/ErrorBoundary";
import { cn } from "@/shared/lib/cn";
import { ProfileCacheContext, type ProfileCache } from "@/entities/user/profileCache";
import { UserProfileCard, UserProfileCardSkeleton } from "@/entities/user/UserProfileCard";

export interface ProfilePanelProps {
  userId: string;
  /** Overrides the cache from context, exactly as on `<UserProfileCard>`. */
  cache?: ProfileCache | undefined;
  className?: string | undefined;
}

/**
 * One profile, with the two boundaries `use()` requires around it.
 *
 * `use()` communicates entirely by throwing: a pending promise suspends to the
 * nearest `<Suspense>`, a rejected one throws to the nearest error boundary.
 * Neither is optional, and the order matters — the error boundary has to be
 * *outside* the Suspense boundary, or a rejection unmounts the boundary that
 * was supposed to catch it.
 *
 * Both boundaries sit inside this component rather than around a group of them,
 * so each panel loads and fails independently: one profile erroring leaves its
 * siblings on screen. Hoisting them to wrap several panels is a real choice
 * with a real cost — the slowest request then decides when *any* of them
 * appears, and one failure blanks all of them.
 *
 * ### Retrying
 *
 * Resetting the error boundary is not enough on its own. The cache keeps
 * rejected promises deliberately (see `promiseCache.ts`), so a bare reset
 * re-renders the card, reads the same rejected promise and rethrows the same
 * error in the same frame — a "Try again" button that visibly does nothing.
 * `onRetry` therefore invalidates the entry *first*, so the reset renders
 * against a fresh request.
 *
 * Usage:
 *   <ProfileCacheProvider cache={cache}>
 *     <ProfilePanel userId="u-1" />
 *   </ProfileCacheProvider>
 */
export function ProfilePanel({ userId, cache, className }: ProfilePanelProps) {
  // Same conditional context read as the card: an explicit cache wins and the
  // context is never subscribed to.
  const resolved = cache ?? use(ProfileCacheContext);

  return (
    <ErrorBoundary
      fallback={({ error, reset }) => (
        <div
          role="alert"
          data-testid="profile-error"
          className={cn(
            "flex flex-col items-start gap-3 rounded-[var(--radius-lg)] p-4",
            "border border-[var(--color-danger)] text-sm text-[var(--color-fg)]",
            className,
          )}
        >
          <span>
            <strong className="font-semibold">Could not load {userId}.</strong> {error.message}
          </span>
          <Button
            size="sm"
            variant="secondary"
            data-testid="retry-profile"
            onClick={() => {
              // Invalidate before reset — see the note above.
              resolved?.invalidate(userId);
              reset();
            }}
          >
            Try again
          </Button>
        </div>
      )}
    >
      <Suspense fallback={<UserProfileCardSkeleton className={className} />}>
        <UserProfileCard userId={userId} cache={resolved ?? undefined} className={className} />
      </Suspense>
    </ErrorBoundary>
  );
}
