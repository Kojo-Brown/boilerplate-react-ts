/**
 * The contract between whoever reports a query failure and whoever displays it.
 *
 * This is deliberately separate from the `QueryClient` that dispatches these
 * events. The client is an application singleton: it is constructed once, in
 * `app/`, wired to a `baseUrl` and a store. The *event names and payloads* are
 * neither — they are a shape any listener can depend on, and a listener is
 * ordinarily a `shared` hook or a feature's UI, both of which sit below `app/`.
 * Leaving the constants on the client module would have forced every listener
 * to import the singleton to learn a string, which the import-boundary rule
 * rejects (see `docs/feature-sliced-design.md`).
 */

/** Dispatched on `window` for any query or mutation error other than a 401. */
export const QUERY_ERROR_EVENT = "query:error" as const;

/**
 * Dispatched on `window` when a request comes back 401.
 *
 * Kept distinct from {@link QUERY_ERROR_EVENT} because an expired session is
 * not a message to show the user — it is a signal to re-authenticate.
 */
export const AUTH_EXPIRED_EVENT = "auth:expired" as const;

/** Payload of a {@link QUERY_ERROR_EVENT}. */
export interface QueryErrorDetail {
  message: string;
}
