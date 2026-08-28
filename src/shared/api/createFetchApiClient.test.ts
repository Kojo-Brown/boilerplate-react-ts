import { describe, it, expect, vi, afterEach } from "vitest";
import { ApiError, type SessionPort } from "@/shared/api/apiClient";
import { createFetchApiClient } from "@/shared/api/createFetchApiClient";

const BASE_URL = "https://api.test";

type FetchMock = ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

/**
 * A `fetch` double typed as the real one.
 *
 * `vi.fn(() => …)` infers its parameters from the implementation, which makes
 * `mock.calls` an empty tuple and every assertion about the URL or the headers
 * a type error. Typing the mock as `typeof globalThis.fetch` is what keeps the
 * recorded arguments readable.
 */
function fetchReturning(...responses: Response[]): FetchMock {
  const mock = vi.fn<typeof globalThis.fetch>();
  if (responses.length === 1) {
    const only = responses[0] as Response;
    // Every call gets a *clone*. A Response body can only be read once, and the
    // error path reads it — a mock that handed the same object to a retry would
    // throw "Body is unusable" instead of failing the assertion it was written
    // for, which is a confusing way to learn nothing.
    mock.mockImplementation(() => Promise.resolve(only.clone()));
  } else {
    responses.forEach((res) => mock.mockResolvedValueOnce(res));
  }
  return mock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * A session port built from three counters.
 *
 * The point of the whole exercise is that this is all a test needs: no store,
 * no reducers, no localStorage. `tokens` is the queue `refreshAccessToken`
 * hands out, so a test decides in advance whether a refresh succeeds.
 */
function createTestSession(options: { token?: string | null; tokens?: (string | null)[] } = {}) {
  const queue = [...(options.tokens ?? [])];
  let current = options.token ?? null;
  const port: SessionPort = {
    getAccessToken: () => current,
    refreshAccessToken: vi.fn(() => {
      const next = queue.length > 0 ? (queue.shift() ?? null) : null;
      if (next !== null) current = next;
      return Promise.resolve(next);
    }),
    onSessionExpired: vi.fn(),
  };
  return port;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createFetchApiClient", () => {
  it("prefixes the base URL and attaches the access token", async () => {
    const fetchMock = fetchReturning(jsonResponse({ ok: true }));
    const client = createFetchApiClient({
      baseUrl: BASE_URL,
      session: createTestSession({ token: "mock-access-token" }),
      fetch: fetchMock,
    });

    await expect(client.get<{ ok: boolean }>("/posts")).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE_URL}/posts`);
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer mock-access-token");
    expect(init?.method).toBe("GET");
  });

  it("omits the Authorization header when there is no token", async () => {
    const fetchMock = fetchReturning(jsonResponse({ ok: true }));
    const client = createFetchApiClient({
      baseUrl: BASE_URL,
      session: createTestSession({ token: null }),
      fetch: fetchMock,
    });

    await client.get("/public");

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.has("Authorization")).toBe(false);
  });

  it("serialises the body for the verbs that take one and forwards the signal", async () => {
    const fetchMock = fetchReturning(jsonResponse({ id: 1 }));
    const client = createFetchApiClient({
      baseUrl: BASE_URL,
      session: createTestSession(),
      fetch: fetchMock,
    });
    const controller = new AbortController();

    await client.post("/posts", { title: "hello" }, { signal: controller.signal });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ title: "hello" }));
    expect(init?.signal).toBe(controller.signal);
  });

  it("throws an ApiError carrying the status and the parsed error body", async () => {
    const client = createFetchApiClient({
      baseUrl: BASE_URL,
      session: createTestSession(),
      fetch: fetchReturning(jsonResponse({ message: "Nope" }, 422)),
    });

    const error = await client.get("/posts").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, body: { message: "Nope" } });
  });

  it("resolves rather than throwing on a 204 with no body", async () => {
    // The previous client called res.json() unconditionally, so every
    // well-behaved DELETE came back as a SyntaxError from an empty body.
    const client = createFetchApiClient({
      baseUrl: BASE_URL,
      session: createTestSession(),
      fetch: fetchReturning(new Response(null, { status: 204 })),
    });

    await expect(client.delete<undefined>("/posts/1")).resolves.toBeUndefined();
  });

  describe("401 handling", () => {
    it("refreshes once and retries the request with the new token", async () => {
      const session = createTestSession({ token: "expired-token", tokens: ["fresh-token"] });
      const fetchMock = fetchReturning(
        jsonResponse({ message: "expired" }, 401),
        jsonResponse({ ok: true }),
      );

      const client = createFetchApiClient({ baseUrl: BASE_URL, session, fetch: fetchMock });

      await expect(client.get<{ ok: boolean }>("/posts")).resolves.toEqual({ ok: true });
      expect(session.refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("Authorization")).toBe(
        "Bearer fresh-token",
      );
    });

    it("retries exactly once, so a server that always 401s cannot start a refresh storm", async () => {
      const session = createTestSession({ token: "t", tokens: ["fresh-token", "fresher-token"] });
      const fetchMock = fetchReturning(jsonResponse({}, 401));
      const client = createFetchApiClient({ baseUrl: BASE_URL, session, fetch: fetchMock });

      await expect(client.get("/posts")).rejects.toBeInstanceOf(ApiError);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(session.refreshAccessToken).toHaveBeenCalledTimes(1);
    });

    it("makes one refresh for a burst of overlapping 401s, and expires the session once", async () => {
      // The behaviour the old module-level `isRefreshing` flag plus resolver
      // queue was reimplementing by hand. A shared promise is the mechanism.
      //
      // The refresh is held open deliberately. Single-flight is about *overlap*
      // — an instantly-resolving refresh is never in flight when the second 401
      // arrives, so a test built on one would pass against a client that had no
      // sharing at all.
      let release: (token: string | null) => void = () => undefined;
      const gate = new Promise<string | null>((resolve) => {
        release = resolve;
      });
      const session: SessionPort = {
        getAccessToken: () => "expired-token",
        refreshAccessToken: vi.fn(() => gate),
        onSessionExpired: vi.fn(),
      };
      const client = createFetchApiClient({
        baseUrl: BASE_URL,
        session,
        fetch: fetchReturning(jsonResponse({}, 401)),
      });

      const pending = Promise.allSettled([
        client.get("/a"),
        client.get("/b"),
        client.get("/c"),
        client.get("/d"),
        client.get("/e"),
      ]);

      // Let all five 401s land while the refresh is still open.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      expect(session.refreshAccessToken).toHaveBeenCalledTimes(1);

      release(null);
      const results = await pending;

      expect(results.every((r) => r.status === "rejected")).toBe(true);
      expect(session.refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(session.onSessionExpired).toHaveBeenCalledTimes(1);
    });

    it("treats a refresh that throws as a refresh that failed", async () => {
      const session: SessionPort = {
        getAccessToken: () => "expired-token",
        refreshAccessToken: () => Promise.reject(new Error("refresh endpoint unreachable")),
        onSessionExpired: vi.fn(),
      };
      const client = createFetchApiClient({
        baseUrl: BASE_URL,
        session,
        fetch: fetchReturning(jsonResponse({}, 401)),
      });

      // The caller is owed the 401 it actually got, not a transport error from
      // a request it never made.
      const error = await client.get("/posts").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 401 });
      expect(session.onSessionExpired).toHaveBeenCalledTimes(1);
    });

    it("starts a new refresh for a later 401 once the first one has settled", async () => {
      const session = createTestSession({ token: "t1", tokens: ["t2", "t3"] });
      const fetchMock = fetchReturning(
        jsonResponse({}, 401),
        jsonResponse({ n: 1 }),
        jsonResponse({}, 401),
        jsonResponse({ n: 2 }),
      );
      const client = createFetchApiClient({ baseUrl: BASE_URL, session, fetch: fetchMock });

      await expect(client.get<{ n: number }>("/a")).resolves.toEqual({ n: 1 });
      await expect(client.get<{ n: number }>("/b")).resolves.toEqual({ n: 2 });
      expect(session.refreshAccessToken).toHaveBeenCalledTimes(2);
    });

    it("does not intercept a non-401 failure", async () => {
      const session = createTestSession({ token: "t", tokens: ["fresh"] });
      const client = createFetchApiClient({
        baseUrl: BASE_URL,
        session,
        fetch: fetchReturning(jsonResponse({}, 500)),
      });

      await expect(client.get("/posts")).rejects.toMatchObject({ status: 500 });
      expect(session.refreshAccessToken).not.toHaveBeenCalled();
    });

    it("keeps its refresh state per instance", async () => {
      // The regression that motivated moving this out of module scope: with the
      // bookkeeping shared, a 401 on one client could be resumed by a refresh
      // another client started — a request sent with a token minted for a
      // different session.
      const sessionA = createTestSession({ token: "a-expired", tokens: ["a-fresh"] });
      const sessionB = createTestSession({ token: "b-expired", tokens: ["b-fresh"] });

      const fetchFor = (freshToken: string) =>
        fetchReturning(jsonResponse({}, 401), jsonResponse({ token: freshToken }));

      const fetchA = fetchFor("a-fresh");
      const fetchB = fetchFor("b-fresh");
      const clientA = createFetchApiClient({
        baseUrl: BASE_URL,
        session: sessionA,
        fetch: fetchA,
      });
      const clientB = createFetchApiClient({
        baseUrl: BASE_URL,
        session: sessionB,
        fetch: fetchB,
      });

      await Promise.all([clientA.get("/a"), clientB.get("/b")]);

      expect(sessionA.refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(sessionB.refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(new Headers(fetchA.mock.calls[1]?.[1]?.headers).get("Authorization")).toBe(
        "Bearer a-fresh",
      );
      expect(new Headers(fetchB.mock.calls[1]?.[1]?.headers).get("Authorization")).toBe(
        "Bearer b-fresh",
      );
    });
  });

  it("resolves the global fetch per call rather than capturing it at construction", async () => {
    // MSW installs itself by replacing globalThis.fetch after modules are
    // evaluated. A client that captured the global up front would hold the
    // original and bypass every handler — silently, and only in the suites that
    // rely on MSW.
    const client = createFetchApiClient({ baseUrl: BASE_URL, session: createTestSession() });

    const installed = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ from: "installed-later" }));

    await expect(client.get<{ from: string }>("/posts")).resolves.toEqual({
      from: "installed-later",
    });
    expect(installed).toHaveBeenCalledWith(`${BASE_URL}/posts`, expect.anything());
  });
});
