import {
  ApiError,
  type ApiClient,
  type ApiMethod,
  type ApiRequestOptions,
} from "@/shared/api/apiClient";
import { isAbortError, sleepWithAbort } from "@/shared/lib/abort";
import {
  DEFAULT_BACKOFF,
  backoffWithJitterMs,
  parseRetryAfterMs,
  type BackoffOptions,
} from "@/shared/lib/retrySchedule";

/**
 * Wraps an {@link ApiClient} so transient failures are tried again on a
 * jittered exponential schedule.
 *
 * ### Why a decorator and not a flag on the client
 *
 * `createFetchApiClient` already carries one retry — the single-flight token
 * refresh — and that one is not a policy, it is part of what "authenticated
 * request" means. This is a policy: which failures are worth repeating, how
 * long to wait, how many times. Keeping them apart means the refresh logic is
 * not reachable from a test about backoff, a caller can compose one without the
 * other, and the stub client gets the same retry behaviour as the real one
 * without `createStubApiClient` growing a timer.
 *
 * ### Why here and not in TanStack Query
 *
 * TanStack Query has `retry` and it is not the same reach. RTK Query endpoints,
 * `useEffect` calls, imperative loads and the router's loaders all go through
 * the {@link ApiClient} and none of them go through a `QueryClient`. Retrying
 * at the transport means one policy for every caller, and it is why
 * `app/api/queryClient.ts` now sets `retry: false`: with both layers on, a 500
 * costs 4 attempts × 3 = 12 requests, and the outer layer cannot see the
 * `Retry-After` the inner one is honouring.
 */

/** A retry that is about to happen. */
export interface RetryAttemptInfo {
  readonly method: ApiMethod;
  readonly path: string;
  /** 1 for the first retry — attempt 0 is the original request. */
  readonly attempt: number;
  /** How long the client will wait before making it. */
  readonly delayMs: number;
  /** What the previous attempt failed with. */
  readonly error: unknown;
}

export interface RetryOptions {
  /**
   * Retries after the original request. Default 3, so 4 attempts in total.
   */
  readonly maxRetries?: number | undefined;
  readonly backoff?: BackoffOptions | undefined;
  /**
   * Which verbs may be repeated. Defaults to the idempotent ones —
   * `GET`, `PUT`, `DELETE`.
   *
   * `POST` and `PATCH` are absent because a retry is indistinguishable from a
   * second request: a `POST /orders` that fails with a socket hang-up may or
   * may not have created an order, and the client cannot tell which. Where an
   * endpoint takes an idempotency key (the offline queue stamps one — see
   * `shared/offline/syncQueue.ts`) repeating it *is* safe, and that endpoint's
   * client can opt in by listing the verb here.
   */
  readonly methods?: readonly ApiMethod[] | undefined;
  /**
   * A `Retry-After` longer than this is treated as "do not retry" rather than
   * as an instruction to wait. Default 30 s.
   *
   * A rate limiter answering `Retry-After: 3600` is not asking a foreground
   * request to hold a spinner for an hour; it is telling this client to go
   * away. Failing now surfaces that to the user, who can act on it. Waiting
   * hides it behind a request that will look hung for the rest of the session.
   */
  readonly maxRetryAfterMs?: number | undefined;
  /** Overrides {@link isTransientError}. */
  readonly isRetryable?: ((error: unknown) => boolean) | undefined;
  /** Injected for tests; defaults to `Math.random`. */
  readonly random?: (() => number) | undefined;
  /** Injected for tests; defaults to `Date.now`. Only read to resolve `Retry-After` dates. */
  readonly now?: (() => number) | undefined;
  /** Injected for tests; defaults to an abortable `setTimeout`. */
  readonly sleep?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined;
  /**
   * Called before each wait. The hook for a metric or a log line: a retry that
   * succeeds is invisible in the response, and "the p99 is fine, we just make
   * every request twice" is a thing worth being able to notice.
   */
  readonly onRetry?: ((info: RetryAttemptInfo) => void) | undefined;
}

/** Statuses where repeating the identical request can plausibly succeed. */
export function isRetryableStatus(status: number): boolean {
  // 408 Request Timeout and 425 Too Early are both explicitly "try again";
  // 429 is "try again later", with the delay in Retry-After. Everything else
  // in the 4xx range is the client's fault and will fail identically forever.
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * The default policy: a failure the network or the server might not repeat.
 *
 * - A cancellation is never retried. The caller asked for this to stop, and
 *   retrying is the one response that ignores them.
 * - An `ApiError` is retried on {@link isRetryableStatus}.
 * - A bare `TypeError` is what `fetch` rejects with when the request never got
 *   an answer — DNS failure, connection reset, the browser going offline
 *   mid-flight. It carries no structure to test beyond its type, which is
 *   imprecise enough to be worth saying out loud: a genuine `TypeError` thrown
 *   by a bug *inside* a response handler would also be retried. That costs at
 *   most three repeats of a request that is already broken, whereas not
 *   retrying here would drop the single most common transient failure there is.
 * - Anything else is a bug or a rejected parse, and repeating it is noise.
 */
export function isTransientError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  if (error instanceof ApiError) return isRetryableStatus(error.status);
  return error instanceof TypeError;
}

const DEFAULT_METHODS: readonly ApiMethod[] = ["GET", "PUT", "DELETE"];
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_RETRY_AFTER_MS = 30_000;

export function withRetry(client: ApiClient, retryOptions: RetryOptions = {}): ApiClient {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    backoff = DEFAULT_BACKOFF,
    methods = DEFAULT_METHODS,
    maxRetryAfterMs = DEFAULT_MAX_RETRY_AFTER_MS,
    isRetryable = isTransientError,
    random = Math.random,
    now = Date.now,
    sleep = sleepWithAbort,
    onRetry,
  } = retryOptions;

  const retryableMethods = new Set(methods);

  /**
   * How long to wait before retry number `attempt`, or `null` for "do not".
   *
   * The server's answer wins over the local schedule when it gives one, which
   * is the whole reason `ApiError` carries its headers: only the server knows
   * when its rate-limit window resets, and jittering around a number it already
   * told us is guessing at a value we were handed.
   */
  function delayFor(error: unknown, attempt: number): number | null {
    if (error instanceof ApiError) {
      const retryAfter = parseRetryAfterMs(error.headers?.get("retry-after") ?? null, now());
      if (retryAfter !== undefined) {
        return retryAfter > maxRetryAfterMs ? null : retryAfter;
      }
    }
    return backoffWithJitterMs(attempt, backoff, random);
  }

  async function run<T>(
    method: ApiMethod,
    path: string,
    requestOptions: ApiRequestOptions | undefined,
    attemptRequest: () => Promise<T>,
  ): Promise<T> {
    const retryable = retryableMethods.has(method);
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await attemptRequest();
      } catch (error) {
        if (!retryable || attempt >= maxRetries || !isRetryable(error)) throw error;
        const delayMs = delayFor(error, attempt);
        if (delayMs === null) throw error;
        onRetry?.({ method, path, attempt: attempt + 1, delayMs, error });
        // Rejects with the abort reason if the caller cancels mid-wait, which
        // leaves the loop with the cancellation rather than with the failure —
        // the caller asked to stop, and "stopped" is the honest outcome.
        await sleep(delayMs, requestOptions?.signal);
      }
    }
  }

  return {
    get<T>(path: string, options?: ApiRequestOptions): Promise<T> {
      return run("GET", path, options, () => client.get<T>(path, options));
    },
    post<T>(path: string, body: unknown, options?: ApiRequestOptions): Promise<T> {
      return run("POST", path, options, () => client.post<T>(path, body, options));
    },
    put<T>(path: string, body: unknown, options?: ApiRequestOptions): Promise<T> {
      return run("PUT", path, options, () => client.put<T>(path, body, options));
    },
    patch<T>(path: string, body: unknown, options?: ApiRequestOptions): Promise<T> {
      return run("PATCH", path, options, () => client.patch<T>(path, body, options));
    },
    delete<T>(path: string, options?: ApiRequestOptions): Promise<T> {
      return run("DELETE", path, options, () => client.delete<T>(path, options));
    },
  };
}
