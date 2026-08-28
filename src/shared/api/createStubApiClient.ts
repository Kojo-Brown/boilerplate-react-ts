import type { ApiClient, ApiMethod, ApiRequestOptions } from "@/shared/api/apiClient";

/** One call recorded by a {@link StubApiClient}. */
export interface StubApiCall {
  readonly method: ApiMethod;
  readonly path: string;
  /** The request body, for the verbs that take one. `undefined` otherwise. */
  readonly body?: unknown;
}

/**
 * A canned response body: anything JSON can carry.
 *
 * Spelled out rather than written as `unknown`, and that is not pedantry —
 * `unknown | ((call: StubApiCall) => unknown)` collapses to `unknown`, and a
 * handler written against it gets no contextual type, so every route function
 * in every test would have to annotate its own parameter.
 */
export type StubResponseBody = string | number | boolean | null | undefined | object;

/** A route handler: sees the call, returns (or throws) the response. */
export type StubRouteHandler = (call: StubApiCall) => StubResponseBody | Promise<StubResponseBody>;

/**
 * What a route answers: a canned value, or a function of the call.
 *
 * A function is always treated as a handler rather than as the response, which
 * costs nothing — a function is not JSON, so it was never a response a real
 * client could have produced.
 */
export type StubRoute = StubResponseBody | StubRouteHandler;

export interface StubApiClientOptions {
  /**
   * Keyed `"<METHOD> <path>"`, matched exactly — `{ "GET /posts": [...] }`.
   *
   * Exact matching rather than pattern matching is deliberate: a stub that
   * quietly answers a path you did not mean to stub is the same problem as a
   * context default that quietly makes a real request.
   */
  readonly routes?: Record<string, StubRoute> | undefined;
  /**
   * Simulated round-trip in ms. Defaults to 0, which settles on a *microtask*.
   *
   * Zero deliberately does not go through `setTimeout`, so a test running under
   * fake timers does not have to advance them to get a response. Any positive
   * latency does, which is what makes a loading state or a Suspense fallback
   * long enough to assert against.
   */
  readonly latencyMs?: number | undefined;
  /**
   * Called as each request is recorded, before the response is produced.
   *
   * `calls` is a snapshot taken when you read it, which is enough for an
   * assertion after the fact but not for a UI that wants to show requests as
   * they happen — a plain array cannot tell React it changed. This is the hook
   * for that case (`/labs/dependency-inversion` uses it to drive its call log);
   * a test asserting afterwards should keep reading `calls`.
   */
  readonly onRequest?: ((call: StubApiCall) => void) | undefined;
}

export interface StubApiClient extends ApiClient {
  /** Every call so far, oldest first. A fresh copy on each read. */
  readonly calls: readonly StubApiCall[];
  /** Drops the recorded calls, keeping the routes. */
  reset(): void;
}

/**
 * Thrown when a stub is asked for a route it was not given.
 *
 * A distinct type because "the component requested something the story did not
 * stub" is a wiring mistake in the test, not a server error the component
 * should be rendering an error state for.
 */
export class StubRouteNotFoundError extends Error {
  constructor(
    public readonly key: string,
    public readonly known: readonly string[],
  ) {
    super(
      known.length === 0
        ? `No stub route for "${key}" (this stub has no routes at all).`
        : `No stub route for "${key}". Known routes: ${known.join(", ")}.`,
    );
    this.name = "StubRouteNotFoundError";
  }
}

/**
 * An {@link ApiClient} that answers from a table and records what it was asked.
 *
 * This is the other half of the seam: the same context that carries the real
 * client in `main.tsx` carries this one in a test or a Storybook decorator, so a
 * component's data layer can be replaced without MSW, without a service worker,
 * and without the component knowing which host it is running in.
 *
 * `headers` and `signal` are accepted and ignored. A stub has no transport to
 * abort and no server to send headers to, and pretending otherwise would invite
 * assertions about behaviour that only the real client has.
 *
 * Usage:
 *   const client = createStubApiClient({
 *     routes: {
 *       "GET /posts": [{ id: 1, title: "First", body: "…", userId: 1 }],
 *       "POST /posts": (call) => ({ id: 99, ...(call.body as object) }),
 *       "GET /boom": () => {
 *         throw new ApiError(500, "Internal Server Error");
 *       },
 *     },
 *   });
 *   renderWithProviders(<PostFeed />, { apiClient: client });
 *   expect(client.calls).toEqual([{ method: "GET", path: "/posts", body: undefined }]);
 */
export function createStubApiClient(options: StubApiClientOptions = {}): StubApiClient {
  const { routes = {}, latencyMs = 0, onRequest } = options;
  const recorded: StubApiCall[] = [];

  async function respond<T>(call: StubApiCall): Promise<T> {
    recorded.push(call);
    onRequest?.(call);
    if (latencyMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, latencyMs);
      });
    }

    const key = `${call.method} ${call.path}`;
    if (!Object.hasOwn(routes, key)) {
      throw new StubRouteNotFoundError(key, Object.keys(routes));
    }

    const route = routes[key];
    const value = typeof route === "function" ? (route as StubRouteHandler)(call) : route;
    // The one cast in the file, and the reason a stub can never be as safe as
    // the client it replaces: `T` is the caller's claim about a response this
    // table cannot check. Keeping it here means no caller needs its own.
    // `Promise.resolve` rather than a bare `await`, so a handler may return
    // either a value or a promise without the type of `value` becoming a lie.
    return (await Promise.resolve(value)) as T;
  }

  return {
    get calls() {
      return [...recorded];
    },
    reset() {
      recorded.length = 0;
    },
    get<T>(path: string, _options?: ApiRequestOptions): Promise<T> {
      return respond<T>({ method: "GET", path });
    },
    post<T>(path: string, body: unknown, _options?: ApiRequestOptions): Promise<T> {
      return respond<T>({ method: "POST", path, body });
    },
    put<T>(path: string, body: unknown, _options?: ApiRequestOptions): Promise<T> {
      return respond<T>({ method: "PUT", path, body });
    },
    patch<T>(path: string, body: unknown, _options?: ApiRequestOptions): Promise<T> {
      return respond<T>({ method: "PATCH", path, body });
    },
    delete<T>(path: string, _options?: ApiRequestOptions): Promise<T> {
      return respond<T>({ method: "DELETE", path });
    },
  };
}
