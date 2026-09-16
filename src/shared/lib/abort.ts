/**
 * The three things every caller of `AbortSignal` in this codebase needs and the
 * platform does not quite provide: the reason as a value you are allowed to
 * type, a way to recognise a cancellation after the fact, and a wait that ends
 * when the signal does.
 */

/**
 * A cancellation, spelled the way the platform spells one.
 *
 * `fetch` rejects with `DOMException("…", "AbortError")`, and code downstream —
 * TanStack Query's cancellation handling, this project's retry policy — keys
 * off `name === "AbortError"` rather than off the constructor. Anything this
 * module invents has to match that, or a cancelled request looks like a failed
 * one and gets retried.
 */
export function createAbortError(message = "The operation was aborted."): Error {
  // `DOMException` exists in every browser and in Node 17+, but a jsdom-free
  // worker context or an exotic runtime may not have it. The fallback carries
  // the same `name`, which is the part anything downstream actually reads.
  if (typeof DOMException === "function") return new DOMException(message, "AbortError");
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

/**
 * Why `signal` aborted, as something a promise may be rejected with.
 *
 * `AbortSignal.reason` is typed `any` by the DOM lib, so reading it directly
 * launders an untyped value into whatever it touches — the one hole big enough
 * to drive an unchecked property access through. Every read goes through here,
 * and what comes back is narrowed to an `Error` on the way:
 *
 * - **An error-shaped reason passes through untouched.** That is the default
 *   case (`abort()` with no argument produces an `AbortError`) and the common
 *   explicit one (`abort(new Error("route changed"))`), and a caller comparing
 *   the rejection against the reason it supplied must get back the identical
 *   object. `DOMException` is included even where it does not inherit from
 *   `Error` — see {@link isAbortError}.
 * - **Anything else is wrapped**, with the raw value kept as `cause`.
 *   `abort("too slow")` is legal and rejecting with a bare string is not worth
 *   propagating: it produces a rejection with no stack, no name and nothing to
 *   log. The wrapper is named `AbortError`, so every cancellation this module
 *   produces is recognisable as one however it was raised.
 * - **A signal with no reason at all** — a hand-rolled double, an old polyfill
 *   — gets a fresh `AbortError` rather than a rejection with `undefined`.
 */
export function abortReason(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  if (reason === undefined || reason === null) return createAbortError();
  // `instanceof Error` is not enough on its own (jsdom's DOMException), and
  // neither is the name check on its own (`abort(new RangeError())`).
  if (reason instanceof Error || isAbortError(reason)) return reason;
  const wrapped = createAbortError("The operation was aborted.");
  wrapped.cause = reason;
  return wrapped;
}

/**
 * Whether `error` is a cancellation rather than a failure.
 *
 * Matched on `name` alone, and not on `instanceof Error`, because the value
 * `fetch` rejects with is a `DOMException` — which inherits from `Error` in
 * every browser but *not* under jsdom, where it is a standalone class. An
 * `instanceof Error` check therefore reports `false` for a real cancellation in
 * the environment the unit suite runs in, and `true` in the one the application
 * runs in: a predicate that means two different things depending on where it is
 * evaluated. Duck-typing the property both platforms agree on means the same
 * thing in both.
 */
export function isAbortError(error: unknown): error is Error {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}

/**
 * Resolves after `ms`, or rejects the moment `signal` aborts.
 *
 * The rejection is the point. A retry decorator that waited with a plain
 * `setTimeout` would hold a cancelled request open for the length of its
 * backoff — the user has navigated away, the component has unmounted, and the
 * request still has 4 seconds of politeness to observe before it can notice.
 * Here, an abort ends the wait in the same tick it arrives.
 *
 * The timer is cleared on abort and the listener removed on resolve, so neither
 * path leaves the other behind.
 */
export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
