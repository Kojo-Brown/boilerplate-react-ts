import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryCache, MutationCache } from "@tanstack/react-query";
import { queryClient } from "@/app/api/queryClient";
import {
  QUERY_ERROR_EVENT,
  AUTH_EXPIRED_EVENT,
  type QueryErrorDetail,
} from "@/shared/api/queryEvents";
import { ApiError } from "@/shared/api/apiClient";

function simulateQueryError(error: Error) {
  queryClient.getQueryCache().config.onError?.(error, {} as never);
}

describe("queryClient — configuration", () => {
  it("uses a QueryCache instance", () => {
    expect(queryClient.getQueryCache()).toBeInstanceOf(QueryCache);
  });

  it("uses a MutationCache instance", () => {
    expect(queryClient.getMutationCache()).toBeInstanceOf(MutationCache);
  });

  it("sets staleTime to 5 minutes", () => {
    expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(1000 * 60 * 5);
  });

  it("sets gcTime to 10 minutes", () => {
    expect(queryClient.getDefaultOptions().queries?.gcTime).toBe(1000 * 60 * 10);
  });

  // Retrying moved into the transport (`shared/api/withRetry.ts`), which is the
  // only layer that can read `Retry-After` and the only one every caller goes
  // through. This assertion is what keeps the two layers from both being on:
  // a `retry` that quietly came back here would multiply the transport's
  // attempts rather than replace them, and nothing about a green suite would
  // say so — the requests all succeed, there are just twelve of them.
  it("leaves retrying to the ApiClient", () => {
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(false);
  });
});

describe("queryClient — global error handler", () => {
  const listeners: { event: string; fn: EventListener }[] = [];

  function addListener(event: string, fn: EventListener) {
    listeners.push({ event, fn });
    window.addEventListener(event, fn);
  }

  afterEach(() => {
    while (listeners.length) {
      const item = listeners.pop()!;
      window.removeEventListener(item.event, item.fn);
    }
    vi.restoreAllMocks();
  });

  it("dispatches auth:expired on 401 ApiError", () => {
    const handler = vi.fn();
    addListener(AUTH_EXPIRED_EVENT, handler);

    simulateQueryError(new ApiError(401, "Unauthorized"));

    expect(handler).toHaveBeenCalledOnce();
  });

  it("does not dispatch query:error on 401", () => {
    const handler = vi.fn();
    addListener(QUERY_ERROR_EVENT, handler);

    simulateQueryError(new ApiError(401, "Unauthorized"));

    expect(handler).not.toHaveBeenCalled();
  });

  it("dispatches query:error for non-401 ApiError", () => {
    const handler = vi.fn();
    addListener(QUERY_ERROR_EVENT, handler);

    simulateQueryError(new ApiError(500, "Internal Server Error"));

    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0]![0] as CustomEvent<QueryErrorDetail>;
    expect(event.detail.message).toContain("500");
  });

  it("dispatches query:error for generic Error", () => {
    const handler = vi.fn();
    addListener(QUERY_ERROR_EVENT, handler);

    simulateQueryError(new Error("Network failure"));

    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0]![0] as CustomEvent<QueryErrorDetail>;
    expect(event.detail.message).toBe("Network failure");
  });
});
