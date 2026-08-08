import { createContext } from "react";
import type { UserProfile } from "@/lib/profileApi";
import type { PromiseCache } from "@/lib/promiseCache";

export type ProfileCache = PromiseCache<string, UserProfile>;

/**
 * The profile cache for the surrounding subtree, or `null` outside a provider.
 *
 * Exported as the context object itself rather than behind a `useProfileCache`
 * hook, because consumers read it with `use()` — and the point of `use(Context)`
 * is that the read can be skipped. Wrapping it in a hook would put the
 * rules-of-hooks constraint back and take that away.
 *
 * `null` is the "no provider" sentinel; the default is not a working cache on
 * purpose, so a component rendered outside the provider fails loudly instead of
 * silently starting requests against a second, unshared cache.
 *
 * The provider lives in `ProfileCacheProvider.tsx`: a module that exports both a
 * component and a non-component keeps Fast Refresh from updating either.
 */
export const ProfileCacheContext = createContext<ProfileCache | null>(null);
