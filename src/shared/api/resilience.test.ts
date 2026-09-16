import { describe, it, expect, vi, afterEach } from "vitest";
import type { SessionPort } from "@/shared/api/apiClient";
import { createFetchApiClient } from "@/shared/api/createFetchApiClient";
import { withDedupe } from "@/shared/api/withDedupe";
import { withRetry } from "@/shared/api/withRetry";
import { isAbortError } from "@/shared/lib/abort";

/**
 * The composed client, over a real `fetch` double.
 *
 * `withRetry` and `withDedupe` have their own unit tests against a scripted
 * `ApiClient`; this file is the seam those cannot reach — that the decorators
 * still behave when the thing underneath them is the actual fetch client, with
 * its own 401 refresh, its own response parsing and a real `AbortSignal`
 * reaching a real request.
 */

const BASE_URL = "https://api.test";

const session: SessionPort = {
  getAccessToken: () => "mock-access-token",
  refreshAccessToken: () => Promise.resolve("mock-refreshed-token"),
  onSessionExpired: () => undefined,
};

function jsonResponse(body: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
}

function resilientClient(fetchMock: ReturnType<typeof vi.fn<typeof globalThis.fetch>>) {
  return withDedupe(
    withRetry(createFetchApiClient({ baseUrl: BASE_URL, session, fetch: fetchMock }), {
      // Deterministic and instant: the schedule's arithmetic is asserted in
      // `retrySchedule.test.ts`, and what matters here is that the wiring works.
      sleep: () => Promise.resolve(),
      random: () => 0.5,
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the composed API client", () => {
  it("makes one request for concurrent identical GETs", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(jsonResponse([{ id: 1 }])),
    );
    const api = resilientClient(fetchMock);

    const results = await Promise.all([
      api.get<{ id: number }[]>("/posts"),
      api.get<{ id: number }[]>("/posts"),
      api.get<{ id: number }[]>("/posts"),
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(results).toEqual([[{ id: 1 }], [{ id: 1 }], [{ id: 1 }]]);
  });

  it("retries a 503 and returns the body of the attempt that succeeded", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "overloaded" }, 503));
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, title: "First" }));
    const api = resilientClient(fetchMock);

    await expect(api.get<{ id: number; title: string }>("/posts/1")).resolves.toEqual({
      id: 1,
      title: "First",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a network failure, which fetch reports as a TypeError", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const api = resilientClient(fetchMock);

    await expect(api.get<{ ok: boolean }>("/health")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 404", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(jsonResponse({ error: "gone" }, 404)),
    );
    const api = resilientClient(fetchMock);

    await expect(api.get("/posts/999")).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reads Retry-After off a real response", async () => {
    const sleep = vi.fn<(ms: number, signal?: AbortSignal) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "slow down" }, 429, { "Retry-After": "3" }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const api = withRetry(createFetchApiClient({ baseUrl: BASE_URL, session, fetch: fetchMock }), {
      sleep,
    });

    await expect(api.get<{ ok: boolean }>("/posts")).resolves.toEqual({ ok: true });
    // The whole reason `ApiError` carries its headers: without them the client
    // would back off on its own 250 ms schedule against a server that just said
    // three seconds.
    expect(sleep.mock.calls[0]?.[0]).toBe(3_000);
  });

  it("aborts the underlying request when the only caller cancels", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const fetchMock = vi.fn<typeof globalThis.fetch>((_input, init) => {
      seen.push(init?.signal ?? undefined);
      // Never settles on its own: the abort is what ends it, which is the point.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The user aborted a request.", "AbortError"));
        });
      });
    });
    const api = resilientClient(fetchMock);
    const controller = new AbortController();

    const pending = api.get("/posts", { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toSatisfy(isAbortError);
    expect(seen[0]?.aborted).toBe(true);
  });

  it("keeps the request alive for the callers that did not cancel", async () => {
    let settle: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise<Response>((resolve) => {
          settle = resolve;
        }),
    );
    const api = resilientClient(fetchMock);
    const leaving = new AbortController();

    const abandoned = api.get("/posts", { signal: leaving.signal });
    const waiting = api.get<{ ok: boolean }>("/posts");

    leaving.abort();
    await expect(abandoned).rejects.toSatisfy(isAbortError);

    settle?.(jsonResponse({ ok: true }));
    await expect(waiting).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
