import { describe, it, expect, vi } from "vitest";
import { createSectionCache } from "@/entities/report/sectionCache";

interface TestSections extends Record<string, unknown> {
  summary: { title: string };
  rows: readonly number[];
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (e: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createSectionCache", () => {
  it("returns the identical promise for repeated reads of a section", () => {
    const cache = createSectionCache<TestSections>({
      summary: () => Promise.resolve({ title: "hello" }),
      rows: () => Promise.resolve([1, 2]),
    });

    // Identity, not equality: `use()` re-reads on every render pass and a new
    // promise each time would suspend forever.
    expect(cache.read("summary")).toBe(cache.read("summary"));
  });

  it("calls each loader at most once", async () => {
    const summary = vi.fn(() => Promise.resolve({ title: "hello" }));
    const cache = createSectionCache<TestSections>({
      summary,
      rows: () => Promise.resolve([1]),
    });

    await Promise.all([cache.read("summary"), cache.read("summary"), cache.read("summary")]);

    expect(summary).toHaveBeenCalledTimes(1);
  });

  it("does not start a section that is never read or prefetched", () => {
    const rows = vi.fn(() => Promise.resolve([1]));
    const cache = createSectionCache<TestSections>({
      summary: () => Promise.resolve({ title: "hello" }),
      rows,
    });

    void cache.read("summary");

    expect(rows).not.toHaveBeenCalled();
    expect(cache.startedSections()).toEqual(["summary"]);
  });

  it("prefetch starts a section without reading it, and read then reuses it", async () => {
    const rows = vi.fn(() => Promise.resolve([1, 2, 3]));
    const cache = createSectionCache<TestSections>({
      summary: () => Promise.resolve({ title: "hello" }),
      rows,
    });

    cache.prefetch("rows");
    expect(rows).toHaveBeenCalledTimes(1);

    // The whole point: the later read is served by the request prefetch
    // started, rather than starting a second one.
    await expect(cache.read("rows")).resolves.toEqual([1, 2, 3]);
    expect(rows).toHaveBeenCalledTimes(1);
  });

  it("records the order sections were started in", () => {
    const cache = createSectionCache<TestSections>({
      summary: () => Promise.resolve({ title: "hello" }),
      rows: () => Promise.resolve([1]),
    });

    cache.prefetch("rows", "summary");

    expect(cache.startedSections()).toEqual(["rows", "summary"]);
  });

  it("keeps a rejected entry so the error is rethrown rather than silently retried", async () => {
    const rows = vi.fn(() => Promise.reject(new Error("boom")));
    const cache = createSectionCache<TestSections>({
      summary: () => Promise.resolve({ title: "hello" }),
      rows,
    });

    await expect(cache.read("rows")).rejects.toThrow("boom");
    // Dropping the entry here would hand the next read a fresh *pending*
    // promise, so the component would suspend instead of throwing and the
    // fallback would sit there forever. See `promiseCache.ts`.
    await expect(cache.read("rows")).rejects.toThrow("boom");
    expect(rows).toHaveBeenCalledTimes(1);
  });

  it("does not report an unread rejected prefetch as an unhandled rejection", async () => {
    // Prefetching is where this matters most: a read that nobody performs is
    // the normal case for a section the layout never got round to rendering.
    //
    // `@types/node` is not a dependency here (this is a browser app), so the
    // host process is reached through a narrow structural type rather than by
    // pulling in the whole Node typings surface.
    const host = globalThis as unknown as {
      process: {
        on(event: "unhandledRejection", listener: () => void): unknown;
        off(event: "unhandledRejection", listener: () => void): unknown;
      };
    };

    const unhandled = vi.fn();
    host.process.on("unhandledRejection", unhandled);

    const cache = createSectionCache<TestSections>({
      summary: () => Promise.resolve({ title: "hello" }),
      rows: () => Promise.reject(new Error("nobody reads me")),
    });
    cache.prefetch("rows");

    // Two macrotasks is well past the point the runtime would have reported it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    host.process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("invalidate lets the next read start a fresh request", async () => {
    const rows = vi.fn(() => Promise.resolve([1]));
    const cache = createSectionCache<TestSections>({
      summary: () => Promise.resolve({ title: "hello" }),
      rows,
    });

    void cache.read("rows");
    expect(cache.invalidate("rows")).toBe(true);
    await cache.read("rows");

    expect(rows).toHaveBeenCalledTimes(2);
    expect(cache.invalidate("rows")).toBe(true);
    expect(cache.invalidate("summary")).toBe(false);
  });

  it("clear drops every entry", async () => {
    const summary = vi.fn(() => Promise.resolve({ title: "hello" }));
    const cache = createSectionCache<TestSections>({
      summary,
      rows: () => Promise.resolve([1]),
    });

    void cache.read("summary");
    cache.clear();
    await cache.read("summary");

    expect(summary).toHaveBeenCalledTimes(2);
  });

  it("throws for a section with no registered loader", () => {
    // Reachable only from untyped callers, which is exactly when a silent
    // `undefined` would be hardest to trace.
    const cache = createSectionCache<TestSections>({
      summary: () => Promise.resolve({ title: "hello" }),
      rows: () => Promise.resolve([1]),
    }) as unknown as { read: (section: string) => Promise<unknown> };

    expect(() => cache.read("nope")).toThrow('No loader registered for section "nope"');
  });

  it("hands a pending section the same promise the prefetch created", async () => {
    const gate = deferred<readonly number[]>();
    const cache = createSectionCache<TestSections>({
      summary: () => Promise.resolve({ title: "hello" }),
      rows: () => gate.promise,
    });

    cache.prefetch("rows");
    const read = cache.read("rows");
    gate.resolve([7]);

    await expect(read).resolves.toEqual([7]);
  });
});
