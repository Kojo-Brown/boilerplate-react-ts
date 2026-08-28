import {
  ApiError,
  type ApiClient,
  type ApiMethod,
  type ApiRequestOptions,
  type SessionPort,
} from "@/shared/api/apiClient";

/**
 * The production {@link ApiClient}: `fetch`, a bearer token, and one retry
 * behind a single-flight refresh.
 *
 * Everything it used to reach for is now a parameter. That is not a stylistic
 * preference — the previous version imported the Redux store singleton to read
 * `state.auth.token` and to dispatch `logout()`, which made three things true
 * at once: no test could exercise the refresh path without mutating global
 * store state, no lower layer could import the client (the store lives in
 * `app/`, the top layer), and two clients could never coexist because the
 * refresh bookkeeping was module-level rather than per-instance.
 */
export interface FetchApiClientOptions {
  /** Prefixed to every path. Trailing slashes are not trimmed — pass it clean. */
  readonly baseUrl: string;
  readonly session: SessionPort;
  /**
   * The `fetch` to use. Defaults to the global one, resolved *per call*.
   *
   * The laziness matters more than it looks. MSW's browser worker and its Node
   * `setupServer` both install themselves by replacing `globalThis.fetch`, and
   * they do it after modules are evaluated — a client that captured
   * `globalThis.fetch` at construction would hold the original and quietly
   * bypass every handler. Reading it at call time is also what keeps a test
   * free to swap the global between requests.
   */
  readonly fetch?: typeof globalThis.fetch | undefined;
}

interface RequestSpec {
  readonly method: ApiMethod;
  readonly path: string;
  readonly body?: unknown;
  readonly options?: ApiRequestOptions | undefined;
}

/**
 * Reads the response body, tolerating the empty ones.
 *
 * A `DELETE` that answers `204 No Content` has no body, and `res.json()` throws
 * on an empty one — so the previous client turned every well-behaved delete
 * into a `SyntaxError`. `undefined as T` is the honest answer: the caller
 * declared `delete<void>`, and there is nothing to parse.
 */
async function readBody<T>(res: Response): Promise<T> {
  if (res.status === 204 || res.headers.get("Content-Length") === "0") {
    return undefined as T;
  }
  const text = await res.text();
  if (text === "") return undefined as T;
  return JSON.parse(text) as T;
}

export function createFetchApiClient(options: FetchApiClientOptions): ApiClient {
  const { baseUrl, session, fetch: fetchOverride } = options;

  const doFetch: typeof globalThis.fetch = (input, init) =>
    (fetchOverride ?? globalThis.fetch)(input, init);

  /**
   * The in-flight refresh, shared by every request that hit a 401 while it ran.
   *
   * A promise is the whole mechanism; the previous client kept an
   * `isRefreshing` flag plus an array of resolver callbacks, which is a
   * hand-rolled promise with two extra failure modes — and, being module-level,
   * one that let a request made through *one* client be resumed with a token
   * refreshed by another.
   *
   * Cleared when it settles, so this shares *overlapping* refreshes and does
   * not latch. A 401 arriving after a failed refresh starts a fresh one, which
   * is what lets the client recover once the user has logged in again — a
   * permanent "this session is dead" flag would need clearing from outside, and
   * the only thing that could clear it is the state this client no longer
   * knows about.
   */
  let refreshInFlight: Promise<string | null> | null = null;

  function refreshOnce(): Promise<string | null> {
    refreshInFlight ??= session
      .refreshAccessToken()
      // A refresh that throws is a refresh that failed. Mapping it to `null`
      // here rather than letting it propagate is what makes the caller's error
      // the original 401 instead of whatever the refresh transport did.
      .catch(() => null)
      .then((token) => {
        // Fires once per refresh cycle, so a burst of 401s produces one logout.
        if (token === null) session.onSessionExpired();
        return token;
      })
      .finally(() => {
        refreshInFlight = null;
      });
    return refreshInFlight;
  }

  async function execute<T>(spec: RequestSpec, token: string | null): Promise<T> {
    const headers = new Headers(spec.options?.headers);
    headers.set("Content-Type", "application/json");
    if (token !== null) headers.set("Authorization", `Bearer ${token}`);

    const init: RequestInit = { method: spec.method, headers };
    if (spec.body !== undefined) init.body = JSON.stringify(spec.body);
    if (spec.options?.signal) init.signal = spec.options.signal;

    const res = await doFetch(`${baseUrl}${spec.path}`, init);
    if (!res.ok) {
      // An error body is caller-defined JSON; `unknown` keeps it honest rather
      // than letting `any` leak into ApiError's payload.
      const body: unknown = await res.json().catch(() => undefined);
      throw new ApiError(res.status, res.statusText, body);
    }
    return readBody<T>(res);
  }

  async function request<T>(spec: RequestSpec): Promise<T> {
    try {
      return await execute<T>(spec, session.getAccessToken());
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) throw err;
    }

    const refreshed = await refreshOnce();
    if (refreshed === null) throw new ApiError(401, "Unauthorized");

    // Exactly one retry. A loop here would turn a server that answers 401 to
    // everything — a revoked client, a mis-scoped token — into an unbounded
    // refresh storm against the auth endpoint.
    return execute<T>(spec, refreshed);
  }

  // Written as methods with their own type parameter rather than as arrows: an
  // arrow assigned to `get<T>(…): Promise<T>` has to have `T` flow in from the
  // contextual type and back out through `request`, which works until someone
  // adds an overload and stops working silently.
  return {
    get<T>(path: string, options?: ApiRequestOptions): Promise<T> {
      return request<T>({ method: "GET", path, options });
    },
    post<T>(path: string, body: unknown, options?: ApiRequestOptions): Promise<T> {
      return request<T>({ method: "POST", path, body, options });
    },
    put<T>(path: string, body: unknown, options?: ApiRequestOptions): Promise<T> {
      return request<T>({ method: "PUT", path, body, options });
    },
    patch<T>(path: string, body: unknown, options?: ApiRequestOptions): Promise<T> {
      return request<T>({ method: "PATCH", path, body, options });
    },
    delete<T>(path: string, options?: ApiRequestOptions): Promise<T> {
      return request<T>({ method: "DELETE", path, options });
    },
  };
}
