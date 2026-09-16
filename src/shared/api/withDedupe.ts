import type { ApiClient, ApiMethod, ApiRequestOptions } from "@/shared/api/apiClient";
import { abortReason } from "@/shared/lib/abort";

/**
 * Wraps an {@link ApiClient} so identical requests made while one is already in
 * flight share it instead of starting their own.
 *
 * Three components mounting at once and each asking for `/api/user` is not a
 * caching problem — a cache cannot help, because at the moment the second and
 * third ask there is nothing cached yet. It is a *coalescing* problem, and the
 * unit being shared is the promise.
 *
 * ### Sharing and cancellation are the same feature
 *
 * The naive version is four lines: keep a `Map` of in-flight promises, return
 * the existing one on a hit. It is also wrong the moment any caller passes an
 * `AbortSignal`, and wrong in the direction that is hardest to see: the first
 * component unmounts, TanStack Query aborts its query, and the request dies
 * underneath two other components that are still waiting on it — a cancellation
 * one caller asked for, delivered to callers who did not.
 *
 * So the shared request runs on a controller of its own and each subscriber
 * holds a reference to it. A subscriber that aborts is detached and rejected
 * immediately, and only when the last one leaves is the underlying request
 * actually cancelled. A subscriber that passes no signal never leaves, which
 * makes it exactly the right thing: one uncancellable caller keeps the request
 * alive for everyone.
 *
 * ### What is shared
 *
 * Subscribers resolve with the *same deserialised object*, not with copies.
 * That matches every cache in the application (TanStack Query hands the same
 * object to every `useQuery` too) and it carries the same rule: treat a
 * response as immutable. A caller that mutates what it gets back is mutating
 * what the other subscribers got.
 */

/** A request that was joined rather than started. */
export interface DedupeShareInfo {
  readonly key: string;
  /** How many callers are now waiting on this one request, including the new one. */
  readonly subscribers: number;
}

export interface DedupeOptions {
  /**
   * Which verbs may be coalesced. Defaults to `GET` only.
   *
   * Writes are absent and not by oversight: two `POST /orders` calls with
   * identical bodies are, as far as this client can tell, a user who clicked
   * twice because they meant it. Collapsing them silently discards one, which
   * is a decision no transport has the standing to make. Double-submit belongs
   * to the form that owns the button.
   */
  readonly methods?: readonly ApiMethod[] | undefined;
  /** Overrides {@link defaultDedupeKey}. Returning `null` means "never share this one". */
  readonly keyOf?:
    ((method: ApiMethod, path: string, options?: ApiRequestOptions) => string | null) | undefined;
  /** Observability hook, called once per *joined* request (never for the first). */
  readonly onShare?: ((info: DedupeShareInfo) => void) | undefined;
}

/**
 * `"<METHOD> <path>"`, or `null` when the caller passed its own headers.
 *
 * The key has to name everything that can change the response, and headers
 * can: `Accept-Language`, `If-None-Match`, a tenant id. Rather than hash them
 * into the key — which invites the version of this bug where two requests with
 * *equivalent* headers spelled differently fail to share — a request carrying
 * custom headers opts out of sharing entirely. It is the conservative half of
 * the trade, and the common case (a plain `GET` with the client's own
 * `Authorization`) is unaffected.
 */
export function defaultDedupeKey(
  method: ApiMethod,
  path: string,
  options?: ApiRequestOptions,
): string | null {
  if (options?.headers !== undefined) return null;
  return `${method} ${path}`;
}

/** One in-flight request and the callers waiting on it. */
interface SharedRequest {
  readonly key: string;
  readonly controller: AbortController;
  /**
   * Mutable for one write, at construction.
   *
   * The promise's own cleanup has to delete this entry from the map, so the
   * cleanup closure needs the entry, which therefore has to exist before the
   * promise does. The alternative — a `Map<string, Promise>` beside a
   * `Map<string, AbortController>` — is two maps that can disagree.
   */
  promise: Promise<unknown>;
  subscribers: number;
}

const DEFAULT_METHODS: readonly ApiMethod[] = ["GET"];

export function withDedupe(client: ApiClient, dedupeOptions: DedupeOptions = {}): ApiClient {
  const { methods = DEFAULT_METHODS, keyOf = defaultDedupeKey, onShare } = dedupeOptions;

  const dedupableMethods = new Set(methods);
  const inFlight = new Map<string, SharedRequest>();

  /**
   * Attaches one caller to `shared`, returning the promise that caller sees.
   *
   * Every subscriber gets its own promise rather than the shared one, which is
   * what makes an individual cancellation possible at all: rejecting the shared
   * promise would reject it for everybody.
   */
  function subscribe<T>(shared: SharedRequest, signal: AbortSignal | undefined): Promise<T> {
    shared.subscribers += 1;

    // Guards against the two ways a subscriber can be released — its signal
    // aborting and the shared request settling — racing each other and
    // decrementing the count twice. Returns whether this call was the one that
    // did it.
    let released = false;
    const release = (): boolean => {
      if (released) return false;
      released = true;
      shared.subscribers -= 1;
      return true;
    };

    // Chained off the shared promise rather than rebuilt from it with
    // `new Promise`: a rejection travels down a chain untouched, so the caller
    // catches the client's own `ApiError` and not a copy of it.
    const settled: Promise<T> = shared.promise
      .finally(() => {
        release();
      })
      .then((value) => value as T);

    if (signal === undefined) return settled;

    const cancelled = new Promise<never>((_resolve, reject) => {
      const onAbort = () => {
        // `release()` is false for an abort that arrives after the response, so
        // a late cancellation cannot abort the controller of whatever request
        // holds this key next.
        if (release() && shared.subscribers === 0) {
          // The last one out turns off the lights — and takes the key with
          // them. Eviction has to happen here rather than being left to the
          // request's own cleanup: the underlying promise does not reject until
          // a microtask later, and a caller arriving in that window would join
          // an entry that is already being cancelled and be handed an
          // `AbortError` for a request it had nothing to do with.
          if (inFlight.get(shared.key) === shared) inFlight.delete(shared.key);
          shared.controller.abort(abortReason(signal));
        }
        reject(abortReason(signal));
      };

      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      // One listener per subscriber, removed when the request settles. Without
      // this, a long-lived signal — a component's unmount controller reused
      // across a hundred polls — accumulates one listener per request made
      // under it.
      void settled
        .finally(() => {
          signal.removeEventListener("abort", onAbort);
        })
        .catch(() => undefined);
    });

    return Promise.race([settled, cancelled]);
  }

  function share<T>(
    method: ApiMethod,
    path: string,
    options: ApiRequestOptions | undefined,
    start: (options: ApiRequestOptions) => Promise<T>,
    passThrough: () => Promise<T>,
  ): Promise<T> {
    const key = dedupableMethods.has(method) ? keyOf(method, path, options) : null;
    if (key === null) return passThrough();

    const existing = inFlight.get(key);
    if (existing !== undefined) {
      // Read before subscribing, not after: a subscriber whose signal is
      // already aborted is released synchronously inside `subscribe`, and
      // reporting the count afterwards would report the one it just left.
      const subscribers = existing.subscribers + 1;
      const joined = subscribe<T>(existing, options?.signal);
      onShare?.({ key, subscribers });
      return joined;
    }

    const controller = new AbortController();
    const shared: SharedRequest = {
      key,
      controller,
      // Replaced immediately below; see the field's own note.
      promise: Promise.resolve(),
      subscribers: 0,
    };
    inFlight.set(key, shared);

    // The caller's own `headers` are deliberately not forwarded: `keyOf`
    // returned a key for this request, which under the default means there were
    // none. A custom `keyOf` that decides otherwise is taking responsibility
    // for the headers being part of its key.
    const started = start({ signal: controller.signal }).finally(() => {
      // Guarded so a later request under the same key — started after this one
      // settled — is not evicted by this one's cleanup.
      if (inFlight.get(key) === shared) inFlight.delete(key);
    });

    shared.promise = started;

    // Every subscriber attaches its own handlers, but a request whose
    // subscribers have all aborted has none — and an unobserved rejection is an
    // unhandled rejection, which fails a test run and logs in production.
    void started.catch(() => undefined);

    return subscribe<T>(shared, options?.signal);
  }

  return {
    get<T>(path: string, options?: ApiRequestOptions): Promise<T> {
      return share(
        "GET",
        path,
        options,
        (shared) => client.get<T>(path, shared),
        () => client.get<T>(path, options),
      );
    },
    post<T>(path: string, body: unknown, options?: ApiRequestOptions): Promise<T> {
      return share(
        "POST",
        path,
        options,
        (shared) => client.post<T>(path, body, shared),
        () => client.post<T>(path, body, options),
      );
    },
    put<T>(path: string, body: unknown, options?: ApiRequestOptions): Promise<T> {
      return share(
        "PUT",
        path,
        options,
        (shared) => client.put<T>(path, body, shared),
        () => client.put<T>(path, body, options),
      );
    },
    patch<T>(path: string, body: unknown, options?: ApiRequestOptions): Promise<T> {
      return share(
        "PATCH",
        path,
        options,
        (shared) => client.patch<T>(path, body, shared),
        () => client.patch<T>(path, body, options),
      );
    },
    delete<T>(path: string, options?: ApiRequestOptions): Promise<T> {
      return share(
        "DELETE",
        path,
        options,
        (shared) => client.delete<T>(path, shared),
        () => client.delete<T>(path, options),
      );
    },
  };
}
