/**
 * The HTTP port the application depends on, and nothing else.
 *
 * This module is the *contract* half of the dependency inversion described in
 * `docs/dependency-inversion.md`. It names what a caller needs — five verbs and
 * an error type — without naming `fetch`, a base URL, a token store or Redux.
 * The implementation lives in `createFetchApiClient.ts`, the wiring in
 * `app/api/client.ts`, and the test double in `createStubApiClient.ts`.
 *
 * It sits in `shared/api` rather than `app/api` for a reason the import-boundary
 * rule enforces: `app` is the top layer, so an entity or feature that wanted to
 * make a request could not name the client at all (see
 * `docs/feature-sliced-design.md`). Putting the *interface* at the bottom and
 * the *instance* at the top is the whole shape of the inversion — everything
 * depends downward on the contract, and the one module that knows the concrete
 * client is the composition root.
 */

/** A request failed with a non-2xx status. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body?: unknown,
  ) {
    super(`Request failed: ${status} ${statusText}`);
    this.name = "ApiError";
  }
}

/**
 * Per-request options a caller may set.
 *
 * Deliberately a narrow subset of `RequestInit` rather than the whole thing:
 * `method` and `body` are decided by which verb you called, and a caller that
 * could override them could route a `get()` to a POST. `signal` is here because
 * TanStack Query hands its `queryFn` an `AbortSignal` and dropping it means a
 * cancelled query still finishes its request.
 */
export interface ApiRequestOptions {
  readonly signal?: AbortSignal | undefined;
  readonly headers?: HeadersInit | undefined;
}

/**
 * The read/write surface every caller in this codebase depends on.
 *
 * `T` is the caller's claim about the response shape — this interface parses
 * JSON, it does not validate it. Where the shape matters, parse the result with
 * a Zod schema at the call site; where it is a demo, the claim is the type.
 */
export interface ApiClient {
  get<T>(path: string, options?: ApiRequestOptions): Promise<T>;
  post<T>(path: string, body: unknown, options?: ApiRequestOptions): Promise<T>;
  put<T>(path: string, body: unknown, options?: ApiRequestOptions): Promise<T>;
  patch<T>(path: string, body: unknown, options?: ApiRequestOptions): Promise<T>;
  delete<T>(path: string, options?: ApiRequestOptions): Promise<T>;
}

/** The HTTP verbs {@link ApiClient} exposes, as seen by a test double. */
export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Everything the client needs to know about the session, and no more.
 *
 * The client's only auth concerns are "what token do I attach" and "this one
 * was rejected, can I get another". Where the token comes from, how a refresh
 * is performed and what expiry does to the UI are all the host application's
 * business — `app/api/storeSession.ts` answers them with Redux, a test answers
 * them with three closures, and neither has to know about the other.
 */
export interface SessionPort {
  /** The access token to attach, or `null` for an anonymous request. */
  getAccessToken(): string | null;
  /**
   * Obtain a fresh access token, or `null` when the session cannot be renewed.
   *
   * A rejection is treated exactly like `null` by the client: a refresh that
   * throws is a refresh that failed, and the caller is owed the original 401
   * rather than a transport error from a request it never made.
   */
  refreshAccessToken(): Promise<string | null>;
  /**
   * Called once per failed refresh, not once per request that was waiting on
   * it — a burst of five 401s during one expired session is one logout, not
   * five.
   */
  onSessionExpired(): void;
}
