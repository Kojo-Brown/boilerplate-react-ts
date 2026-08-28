import { env } from "@/shared/config/env";
import { store } from "@/app/store";
import { createFetchApiClient } from "@/shared/api/createFetchApiClient";
import { createStoreSessionPort } from "@/app/api/storeSession";

/**
 * The application's one real {@link import("@/shared/api/apiClient").ApiClient}.
 *
 * Everything this module used to *be* now lives in `shared/api`; what is left is
 * the composition — a base URL from the environment and a session port backed by
 * the store. That is the point of the item this file was rewritten for: the
 * client's dependencies are supplied here, at the top of the graph, instead of
 * being imported from inside it.
 *
 * Nothing below `app/` imports this. Components take the client from context
 * (`useApiClient`), which is what lets a test or a story put a different one
 * behind the same components — see `docs/dependency-inversion.md`.
 */
export const api = createFetchApiClient({
  baseUrl: env.VITE_API_URL,
  session: createStoreSessionPort(store),
});
