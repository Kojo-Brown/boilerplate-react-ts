import { useCallback, useEffect, useState } from "react";
import { QUERY_ERROR_EVENT, type QueryErrorDetail } from "@/api/queryClient";

export function useGlobalQueryError() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onQueryError(event: Event) {
      const { message } = (event as CustomEvent<QueryErrorDetail>).detail;
      setError(message);
    }

    window.addEventListener(QUERY_ERROR_EVENT, onQueryError);
    return () => window.removeEventListener(QUERY_ERROR_EVENT, onQueryError);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { error, clearError };
}
