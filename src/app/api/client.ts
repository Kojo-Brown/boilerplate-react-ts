import { env } from "@/shared/config/env";
import { store } from "@/app/store";
import { createFetchApiClient } from "@/shared/api/createFetchApiClient";
import { createStoreSessionPort } from "@/app/api/storeSession";
import { withDedupe } from "@/shared/api/withDedupe";
import { withRetry } from "@/shared/api/withRetry";

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
 *
 * ### The order of the decorators is the design
 *
 * `withDedupe(withRetry(fetchClient))` — dedupe outermost, and swapping the two
 * gives a different and worse client. Retry inside means a shared request
 * carries *one* retry schedule for all of its subscribers: five components
 * asking for `/user` while the server is failing cost four attempts in total.
 * With dedupe inside, each caller runs its own retry loop over the shared
 * layer, the first failure clears the in-flight entry, and every subsequent
 * attempt is made separately — five callers, twenty requests, which is the
 * thundering herd both decorators exist to prevent.
 *
 * It also settles cancellation. The signal `withRetry` waits on is the shared
 * controller's, so the backoff is abandoned when the last subscriber leaves and
 * not before — a retry that outlived every caller would be a request nobody is
 * waiting for.
 *
 * `docs/request-resilience.md` has the full account.
 */
export const api = withDedupe(
  withRetry(
    createFetchApiClient({
      baseUrl: env.VITE_API_URL,
      session: createStoreSessionPort(store),
    }),
  ),
);
