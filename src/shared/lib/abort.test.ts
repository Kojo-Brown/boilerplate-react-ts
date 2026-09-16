import { describe, it, expect, vi, afterEach } from "vitest";
import { abortReason, createAbortError, isAbortError, sleepWithAbort } from "@/shared/lib/abort";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createAbortError", () => {
  it("is named AbortError, which is what callers match on", () => {
    const error = createAbortError();
    expect(error.name).toBe("AbortError");
    expect(isAbortError(error)).toBe(true);
  });

  it("carries the message it was given", () => {
    expect(createAbortError("navigated away").message).toBe("navigated away");
  });

  it("falls back to a plain Error where DOMException does not exist", () => {
    // Not hypothetical: `DOMException` is a DOM global, and this code also runs
    // inside the service worker's bundle and could run in a bare worker
    // context. The fallback keeps the `name`, which is all anything downstream
    // reads.
    vi.stubGlobal("DOMException", undefined);
    try {
      const error = createAbortError();
      expect(error).toBeInstanceOf(Error);
      expect(isAbortError(error)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("isAbortError", () => {
  it("rejects failures that are not cancellations", () => {
    expect(isAbortError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });

  it("accepts what the platform itself puts on an aborted signal", () => {
    const controller = new AbortController();
    controller.abort();
    // Not a hand-built error: the platform's own default reason, which is the
    // value `fetch` rejects with and the one this predicate exists to
    // recognise. Under jsdom it is a `DOMException` that is not an `Error`,
    // which is exactly why the check is on the name.
    expect(isAbortError(controller.signal.reason)).toBe(true);
  });
});

describe("abortReason", () => {
  it("returns the reason the caller aborted with", () => {
    const controller = new AbortController();
    const reason = new Error("user navigated");
    controller.abort(reason);
    expect(abortReason(controller.signal)).toBe(reason);
  });

  it("falls back to an AbortError for a signal with no reason", () => {
    // A hand-rolled signal stand-in — the case the fallback exists for. A real
    // AbortSignal always populates `reason`; a double may not.
    const signal = { aborted: true, reason: undefined } as unknown as AbortSignal;
    expect(isAbortError(abortReason(signal))).toBe(true);
  });

  it("falls back to an AbortError when given no signal at all", () => {
    expect(isAbortError(abortReason(undefined))).toBe(true);
  });

  it("wraps a reason that is not an error, keeping it as the cause", () => {
    const controller = new AbortController();
    // `abort()` takes any value. A bare string rejection has no stack and no
    // name; the wrapper gives it both without losing what was passed.
    controller.abort("too slow");

    const reason = abortReason(controller.signal);

    expect(isAbortError(reason)).toBe(true);
    expect(reason.cause).toBe("too slow");
  });

  it("passes a non-AbortError Error through unchanged", () => {
    const controller = new AbortController();
    const reason = new RangeError("out of range");
    controller.abort(reason);

    // Identity matters: a caller that aborts with its own error compares the
    // rejection against that object.
    expect(abortReason(controller.signal)).toBe(reason);
  });
});

describe("sleepWithAbort", () => {
  it("resolves after the delay", async () => {
    vi.useFakeTimers();
    const slept = sleepWithAbort(500);
    await vi.advanceTimersByTimeAsync(499);
    let settled = false;
    void slept.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(slept).resolves.toBeUndefined();
  });

  it("rejects the moment the signal aborts, without waiting out the delay", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new Error("gone");
    const slept = sleepWithAbort(10_000, controller.signal);

    controller.abort(reason);

    await expect(slept).rejects.toBe(reason);
    // The timer is cleared rather than left to fire into a settled promise.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects immediately for a signal that is already aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();

    await expect(sleepWithAbort(10_000, controller.signal)).rejects.toSatisfy(isAbortError);
    // No timer was ever created — a wait that starts already-cancelled should
    // not schedule anything to clean up.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not hold a listener on the signal after resolving", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");

    const slept = sleepWithAbort(100, controller.signal);
    await vi.advanceTimersByTimeAsync(100);
    await slept;

    expect(remove).toHaveBeenCalledOnce();
    // And aborting afterwards is inert: the promise has already settled, and an
    // unremoved listener would reject a resolved promise — silent, but it is
    // how a leak of one listener per retry per request starts.
    controller.abort();
    await expect(slept).resolves.toBeUndefined();
  });
});
