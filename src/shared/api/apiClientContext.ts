import { createContext, use } from "react";
import type { ApiClient } from "@/shared/api/apiClient";

/**
 * The API client for the surrounding subtree, or `null` outside a provider.
 *
 * The default is `null` rather than a working client, and that is the single
 * most important decision in this file. A default that fell back to the real
 * singleton would make a component rendered outside the provider *work* — in a
 * unit test, that means a green suite quietly issuing requests to
 * `VITE_API_URL`, which is the failure mode the whole seam exists to remove.
 * Failing loudly at the first read is worth more than any convenience the
 * fallback would buy.
 *
 * Exported alongside {@link useApiClient} rather than hidden behind it because
 * a consumer that wants the raw context — to read it conditionally with `use()`,
 * or to build its own error message — should not have to re-derive it. The
 * provider component lives in `ApiClientProvider.tsx`: a module exporting both
 * a component and a non-component keeps Fast Refresh from updating either.
 */
export const ApiClientContext = createContext<ApiClient | null>(null);

/**
 * The {@link ApiClient} published to this subtree.
 *
 * @throws when no provider is above the caller. The message names the two
 * providers that exist rather than only the missing one, because "wrap it in
 * the provider" is unhelpful when the answer in a test is a different provider
 * from the answer in `main.tsx`.
 */
export function useApiClient(): ApiClient {
  const client = use(ApiClientContext);
  if (client === null) {
    throw new Error(
      "useApiClient must be used inside an <ApiClientProvider>. " +
        "The application supplies one in app/main.tsx; tests get one from " +
        "renderWithProviders, which defaults to createStubApiClient().",
    );
  }
  return client;
}
