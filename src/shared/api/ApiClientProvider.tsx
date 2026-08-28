import type { ReactNode } from "react";
import type { ApiClient } from "@/shared/api/apiClient";
import { ApiClientContext } from "@/shared/api/apiClientContext";

export interface ApiClientProviderProps {
  client: ApiClient;
  children: ReactNode;
}

/**
 * Publishes an {@link ApiClient} to the subtree.
 *
 * The client is passed in rather than constructed here, for the same reason
 * `ProfileCacheProvider` takes its cache: the owner controls its lifetime. A
 * provider that built its own client would build a *new* one on every render,
 * and a client identity that changes is a new value in context — every effect
 * and `queryFn` depending on it re-runs, and the refresh single-flight resets
 * mid-flight.
 *
 * Nesting is meaningful: the innermost provider wins, which is how the lab page
 * swaps a stub in over the application's real client for one subtree, and how a
 * Storybook decorator does the same for one story.
 */
export function ApiClientProvider({ client, children }: ApiClientProviderProps) {
  return <ApiClientContext value={client}>{children}</ApiClientContext>;
}
