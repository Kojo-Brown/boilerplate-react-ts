import { QueryClient, type QueryCache, type MutationCache } from "@tanstack/react-query";

function handleError(error: unknown) {
  if (error instanceof Response && error.status === 401) {
    window.dispatchEvent(new Event("auth:expired"));
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 10,
      retry: (failureCount, error) => {
        if (error instanceof Response && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
  queryCache: { onError: handleError } as unknown as QueryCache,
  mutationCache: { onError: handleError } as unknown as MutationCache,
});
