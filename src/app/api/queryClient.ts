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
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});
