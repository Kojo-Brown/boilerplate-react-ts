import { use } from "react";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { cn } from "@/shared/lib/cn";
import { ProfileCacheContext, type ProfileCache } from "@/entities/user/profileCache";

export interface UserProfileCardProps {
  userId: string;
  /**
   * Overrides the cache from context.
   *
   * When this is supplied the context is never read at all — see the
   * conditional `use()` below.
   */
  cache?: ProfileCache | undefined;
  className?: string | undefined;
}

/**
 * Renders a profile that has not arrived yet.
 *
 * Both halves of the `use()` API are here, and the second one is the
 * interesting one:
 *
 * - **`use(promise)`** unwraps the request. There is no `isLoading`, no
 *   `data === undefined` branch, and no early return — the component is written
 *   as if the data were already there, and Suspense supplies the loading UI.
 *   The promise comes from a cache and never from this render (see
 *   `promiseCache.ts` for why a render-created promise loops forever).
 * - **`use(Context)` can be called conditionally**, which no other hook-shaped
 *   API can. `cache ?? use(ProfileCacheContext)` only evaluates the read when
 *   the prop is absent, so a caller passing a cache explicitly does not
 *   subscribe this component to the context and does not re-render when the
 *   provider's value changes. With `useContext` the read would have to be
 *   unconditional and the subscription unavoidable.
 *
 * This component must be rendered inside a `<Suspense>` boundary, and inside an
 * error boundary if the request can fail: a rejected promise passed to `use()`
 * is rethrown, not returned. `<ProfilePanel>` wires up both.
 *
 * Usage:
 *   <Suspense fallback={<UserProfileCardSkeleton />}>
 *     <UserProfileCard userId="u-1" />
 *   </Suspense>
 */
export function UserProfileCard({ userId, cache, className }: UserProfileCardProps) {
  // Conditional on purpose — the whole point of `use(Context)`.
  const resolved = cache ?? use(ProfileCacheContext);
  if (resolved === null) {
    throw new Error(
      "UserProfileCard needs a profile cache: render it inside <ProfileCacheProvider> or pass the `cache` prop.",
    );
  }

  const profile = use(resolved.read(userId));

  return (
    <article
      data-testid="user-profile-card"
      data-user-id={profile.id}
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h3 className="truncate text-lg font-semibold text-[var(--color-fg)]">{profile.name}</h3>
          <p className="truncate text-sm text-[var(--color-muted-fg)]">{profile.email}</p>
        </div>
        <Badge variant={profile.role === "admin" ? "primary" : "default"}>{profile.role}</Badge>
      </header>
      <p className="text-sm text-[var(--color-muted-fg)]">
        Joined <time dateTime={profile.joinedAt}>{profile.joinedAt}</time>
      </p>
    </article>
  );
}

/**
 * The Suspense fallback for {@link UserProfileCard}.
 *
 * Same outer box and roughly the same height as the real card, so the boundary
 * resolving does not shove the rest of the page around. Announced once via
 * `role="status"`; the individual bars are decorative and `aria-hidden`.
 */
export function UserProfileCardSkeleton({ className }: { className?: string | undefined }) {
  return (
    <div
      role="status"
      aria-label="Loading profile"
      data-testid="user-profile-card-skeleton"
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4",
        className,
      )}
    >
      <Skeleton variant="text" width="60%" />
      <Skeleton variant="text" width="80%" />
      <Skeleton variant="text" width="40%" />
    </div>
  );
}
