import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryCache, MutationCache } from "@tanstack/react-query";
import { queryClient } from "@/app/api/queryClient";
import {
  QUERY_ERROR_EVENT,
  AUTH_EXPIRED_EVENT,
  type QueryErrorDetail,
} from "@/shared/api/queryEvents";
import { ApiError } from "@/app/api/client";

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

  it("does not retry on 4xx ApiErrors", () => {
    const retry = queryClient.getDefaultOptions().queries?.retry;
    if (typeof retry !== "function") throw new Error("retry must be a function");
    expect(retry(0, new ApiError(400, "Bad Request"))).toBe(false);
    expect(retry(0, new ApiError(404, "Not Found"))).toBe(false);
    expect(retry(0, new ApiError(422, "Unprocessable Entity"))).toBe(false);
  });

  it("retries up to 2 times on 5xx ApiErrors", () => {
    const retry = queryClient.getDefaultOptions().queries?.retry;
    if (typeof retry !== "function") throw new Error("retry must be a function");
    const serverError = new ApiError(500, "Internal Server Error");
    expect(retry(0, serverError)).toBe(true);
    expect(retry(1, serverError)).toBe(true);
    expect(retry(2, serverError)).toBe(false);
  });

  it("retries on generic Error (not ApiError)", () => {
    const retry = queryClient.getDefaultOptions().queries?.retry;
    if (typeof retry !== "function") throw new Error("retry must be a function");
    expect(retry(0, new Error("Network failure"))).toBe(true);
    expect(retry(1, new Error("Network failure"))).toBe(true);
    expect(retry(2, new Error("Network failure"))).toBe(false);
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
