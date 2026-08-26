import type { ReactNode } from "react";
import { ProfileCacheContext, type ProfileCache } from "@/entities/user/profileCache";

export interface ProfileCacheProviderProps {
  cache: ProfileCache;
  children: ReactNode;
}

/**
 * Publishes a profile cache to the subtree.
 *
 * The cache is passed in rather than created here so the owner controls its
 * lifetime: it has to outlive every render of the components reading it, and
 * replacing it is the only way to refetch. Remount the subtree when you replace
 * it — swapping it in place is an update, and a `use()` suspension inside a
 * transition keeps the previous UI on screen until the new data lands.
 */
export function ProfileCacheProvider({ cache, children }: ProfileCacheProviderProps) {
  return <ProfileCacheContext value={cache}>{children}</ProfileCacheContext>;
}
