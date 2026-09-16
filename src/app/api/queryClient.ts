import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";
import { ApiError } from "@/shared/api/apiClient";
import {
  AUTH_EXPIRED_EVENT,
  QUERY_ERROR_EVENT,
  type QueryErrorDetail,
} from "@/shared/api/queryEvents";

function handleGlobalError(error: Error): void {
  if (error instanceof ApiError && error.status === 401) {
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    return;
  }

  window.dispatchEvent(
    new CustomEvent<QueryErrorDetail>(QUERY_ERROR_EVENT, {
      detail: { message: error.message },
    }),
  );
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: handleGlobalError,
  }),
  mutationCache: new MutationCache({
    onError: handleGlobalError,
  }),
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 10,
      /**
       * Retrying happens one layer down, in the `ApiClient` itself
       * (`shared/api/withRetry.ts`), so it must not happen here as well.
       *
       * Two retry layers multiply rather than add: this one's 3 attempts over
       * the transport's 4 is 12 requests for a single failing query, on a
       * schedule neither layer fully controls. The transport is the layer that
       * keeps its policy — it is the only one that sees the response headers,
       * so it is the only one that can honour `Retry-After`, and it covers the
       * callers that never touch a `QueryClient` (RTK Query endpoints, router
       * loaders, imperative loads).
       *
       * The consequence to know about: a `queryFn` that does *not* go through
       * the `ApiClient` now gets no retry unless it sets its own. That is the
       * right default — a query built on `navigator.geolocation` or on a
       * third-party SDK has failure modes this project knows nothing about —
       * but it is a change from "everything is retried twice", so a new
       * non-`ApiClient` query should decide deliberately.
       */
      retry: false,
    },
  },
});
