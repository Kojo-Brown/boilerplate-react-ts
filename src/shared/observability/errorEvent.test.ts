import { describe, it, expect, vi, afterEach } from "vitest";
import {
  MAX_CAUSE_DEPTH,
  createEventId,
  fingerprintOf,
  normalizeForGrouping,
  normalizeThrown,
  toExceptionChain,
  trimStack,
} from "@/shared/observability/errorEvent";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeThrown", () => {
  it("keeps an Error's name, message and stack", () => {
    const error = new TypeError("nope");
    expect(normalizeThrown(error)).toMatchObject({ type: "TypeError", value: "nope" });
    expect(normalizeThrown(error).stack).toContain("TypeError");
  });

  it("prefers `name` over the constructor, which a minifier rewrites", () => {
    class VeryDescriptiveError extends Error {
      override name = "VeryDescriptiveError";
    }
    // Renaming the constructor is what a minifier does; `name` survives it
    // because it is an ordinary string property on the instance.
    Object.defineProperty(VeryDescriptiveError, "name", { value: "t" });
    expect(normalizeThrown(new VeryDescriptiveError("x")).type).toBe("VeryDescriptiveError");
  });

  it("gives an Error with an empty message something to display", () => {
    expect(normalizeThrown(new Error("")).value).toBe("<no message>");
  });

  it("describes a thrown Response, which has no message at all", () => {
    const thrown = new Response(null, { status: 404, statusText: "Not Found" });
    expect(normalizeThrown(thrown)).toEqual({ type: "Response", value: "HTTP 404 Not Found" });
  });

  it("describes a thrown Response with no status text", () => {
    expect(normalizeThrown(new Response(null, { status: 503, statusText: "" }))).toEqual({
      type: "Response",
      value: "HTTP 503",
    });
  });

  it.each([
    ["a string", "nope", { type: "NonError", value: "nope" }],
    ["an empty string", "", { type: "NonError", value: "<empty string>" }],
    ["null", null, { type: "NonError", value: "null" }],
    ["undefined", undefined, { type: "NonError", value: "undefined" }],
    ["a number", 42, { type: "NonError", value: "42" }],
    ["a boolean", false, { type: "NonError", value: "false" }],
  ])("describes %s", (_label, thrown, expected) => {
    expect(normalizeThrown(thrown)).toEqual(expected);
  });

  it("reads name and message off a cross-realm Error that fails instanceof", () => {
    // What an Error looks like after crossing a worker or iframe boundary.
    const foreign = { name: "RangeError", message: "out of range", stack: "RangeError\n  at x" };
    expect(normalizeThrown(foreign)).toEqual({
      type: "RangeError",
      value: "out of range",
      stack: "RangeError\n  at x",
    });
  });

  it("previews a plain object, because String({}) says nothing", () => {
    expect(normalizeThrown({ code: 500, detail: "boom" })).toEqual({
      type: "NonError",
      value: '{"code":500,"detail":"boom"}',
    });
  });

  it("truncates a large object preview", () => {
    const value = normalizeThrown({ blob: "x".repeat(5_000) }).value;
    expect(value.length).toBeLessThan(220);
    expect(value.endsWith("…")).toBe(true);
  });

  it("survives an object that cannot be serialised", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(normalizeThrown(cyclic)).toEqual({
      type: "NonError",
      value: "<unserialisable object>",
    });
  });

  it("survives an object whose getter throws", () => {
    const hostile = {
      get boom(): string {
        throw new Error("getter exploded");
      },
    };
    expect(normalizeThrown(hostile).value).toBe("<unserialisable object>");
  });

  it("survives a Symbol, which String() refuses to convert", () => {
    expect(normalizeThrown(Symbol("s")).value).toBe("Symbol(s)");
  });
});

describe("trimStack", () => {
  it("keeps the message line and caps the frames", () => {
    const stack = [
      "Error: boom",
      ...Array.from({ length: 50 }, (_, i) => `    at fn${i} (a.ts)`),
    ].join("\n");
    const trimmed = trimStack(stack, 5).split("\n");
    expect(trimmed[0]).toBe("Error: boom");
    expect(trimmed).toHaveLength(6);
  });

  it("keeps a stack with no recognisable frames rather than emptying it", () => {
    expect(trimStack("something opaque", 5)).toBe("something opaque");
  });
});

describe("toExceptionChain", () => {
  it("orders the thrown value first and the root cause last", () => {
    const root = new Error("connection refused");
    const middle = new Error("query failed", { cause: root });
    const outer = new Error("could not load dashboard", { cause: middle });

    expect(toExceptionChain(outer).map((e) => e.value)).toEqual([
      "could not load dashboard",
      "query failed",
      "connection refused",
    ]);
  });

  it("stops at a self-referential cause instead of hanging", () => {
    const error: Error & { cause?: unknown } = new Error("loop");
    error.cause = error;
    expect(toExceptionChain(error)).toHaveLength(1);
  });

  it("stops at a two-error cause cycle", () => {
    const a: Error & { cause?: unknown } = new Error("a");
    const b: Error & { cause?: unknown } = new Error("b", { cause: a });
    a.cause = b;
    expect(toExceptionChain(a).map((e) => e.value)).toEqual(["a", "b"]);
  });

  it("caps a chain longer than the depth limit", () => {
    let error = new Error("root");
    for (let i = 0; i < 20; i += 1) error = new Error(`wrap ${i}`, { cause: error });
    expect(toExceptionChain(error)).toHaveLength(MAX_CAUSE_DEPTH);
  });

  it("still produces one entry for a thrown null", () => {
    expect(toExceptionChain(null)).toEqual([{ type: "NonError", value: "null" }]);
  });
});

describe("normalizeForGrouping", () => {
  it("replaces a uuid before the digit rule can chew it up", () => {
    expect(normalizeForGrouping("user 3f2504e0-4f89-11d3-9a0c-0305e82c3301 missing")).toBe(
      "user <uuid> missing",
    );
  });

  it("replaces long hex runs", () => {
    expect(normalizeForGrouping("etag a1b2c3d4e5f60718 stale")).toBe("etag <hex> stale");
  });

  it("replaces ids and versions so occurrences of one bug group together", () => {
    expect(normalizeForGrouping("Failed to load user 8421")).toBe("Failed to load user <n>");
    expect(normalizeForGrouping("Failed to load user 9999")).toBe(
      normalizeForGrouping("Failed to load user 1"),
    );
  });
});

describe("fingerprintOf", () => {
  it("groups on the root cause rather than the wrapper", () => {
    const root = new Error("ECONNREFUSED 127.0.0.1:5432");
    const wrapped = new Error("could not load dashboard", { cause: root });
    const other = new Error("could not load settings", {
      cause: new Error("ECONNREFUSED 127.0.0.1:5432"),
    });

    const [a, b] = [
      fingerprintOf(toExceptionChain(wrapped)),
      fingerprintOf(toExceptionChain(other)),
    ];
    // Same root cause, same first two components — the grouping ones.
    expect(a.slice(0, 2)).toEqual(b.slice(0, 2));
  });

  it("distinguishes two different root causes behind one wrapper", () => {
    const timeout = new Error("wrapped", { cause: new Error("timeout") });
    const parse = new Error("wrapped", { cause: new Error("bad json") });
    expect(fingerprintOf(toExceptionChain(timeout))).not.toEqual(
      fingerprintOf(toExceptionChain(parse)),
    );
  });

  it("keeps the outer type as a component so call paths stay distinguishable", () => {
    const chain = toExceptionChain(new TypeError("outer", { cause: new RangeError("inner") }));
    expect(fingerprintOf(chain)).toEqual(["RangeError", "inner", "TypeError"]);
  });

  it("omits the outer component when there is only one exception", () => {
    expect(fingerprintOf(toExceptionChain(new Error("solo")))).toEqual(["Error", "solo"]);
  });

  it("handles an empty chain without throwing", () => {
    expect(fingerprintOf([])).toEqual(["NonError", "<empty>"]);
  });
});

describe("createEventId", () => {
  it("produces 32 lowercase hex characters", () => {
    expect(createEventId()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("falls back to getRandomValues where randomUUID is unavailable", () => {
    // An insecure origin — every LAN-address dev server — exposes `crypto`
    // without `randomUUID`.
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array) => array.fill(0xab),
    });
    expect(createEventId()).toBe("ab".repeat(16));
  });

  it("falls back to Math.random where there is no crypto at all", () => {
    vi.stubGlobal("crypto", undefined);
    expect(createEventId()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("does not repeat itself", () => {
    const ids = new Set(Array.from({ length: 200 }, () => createEventId()));
    expect(ids.size).toBe(200);
  });
});
