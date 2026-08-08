import { describe, it, expect, vi } from "vitest";
import { createPromiseCache } from "@/lib/promiseCache";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("createPromiseCache", () => {
  it("returns the identical promise for repeated reads of the same key", () => {
    const load = vi.fn((key: string) => Promise.resolve(`value:${key}`));
    const cache = createPromiseCache({ load });

    const first = cache.read("a");
    const second = cache.read("a");

    // Identity, not equality: `use()` re-reads on every render pass and a new
    // promise each time would suspend forever.
    expect(second).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keys entries independently", async () => {
    const load = vi.fn((key: string) => Promise.resolve(`value:${key}`));
    const cache = createPromiseCache({ load });

    await expect(cache.read("a")).resolves.toBe("value:a");
    await expect(cache.read("b")).resolves.toBe("value:b");
    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.size()).toBe(2);
  });

  it("does not start a request until the key is read", () => {
    const load = vi.fn((key: string) => Promise.resolve(key));
    const cache = createPromiseCache({ load });

    expect(load).not.toHaveBeenCalled();
    expect(cache.has("a")).toBe(false);

    void cache.read("a");
    expect(cache.has("a")).toBe(true);
  });

  it("shares one in-flight promise between concurrent readers", async () => {
    const gate = deferred<string>();
    const load = vi.fn(() => gate.promise);
    const cache = createPromiseCache({ load });

    const readers = [cache.read("a"), cache.read("a"), cache.read("a")];
    gate.resolve("done");

    await expect(Promise.all(readers)).resolves.toEqual(["done", "done", "done"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps a rejected entry so the next read rethrows instead of re-suspending", async () => {
    const load = vi.fn(() => Promise.reject(new Error("boom")));
    const cache = createPromiseCache({ load });

    const first = cache.read("a");
    await expect(first).rejects.toThrow("boom");

    // The point of the retained entry: React re-renders the component after the
    // rejection, and it must get *this* settled promise back — a fresh pending
    // one would suspend again and the error would never reach a boundary.
    expect(cache.read("a")).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not report a cached rejection as unhandled", async () => {
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

    const cache = createPromiseCache({ load: () => Promise.reject(new Error("never read")) });
    void cache.read("a");

    // An entry created during render is not observed by `use()` until the retry
    // pass — and one nothing re-reads is never observed at all. Two macrotasks
    // is well past the point the runtime would have reported it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    host.process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("retries after invalidate", async () => {
    let attempt = 0;
    const load = vi.fn(() => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error("boom")) : Promise.resolve("recovered");
    });
    const cache = createPromiseCache({ load });

    await expect(cache.read("a")).rejects.toThrow("boom");

    expect(cache.invalidate("a")).toBe(true);
    await expect(cache.read("a")).resolves.toBe("recovered");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reports invalidate on an unknown key as a no-op", () => {
    const cache = createPromiseCache({ load: (key: string) => Promise.resolve(key) });

    expect(cache.invalidate("missing")).toBe(false);
  });

  it("clears every entry", async () => {
    const load = vi.fn((key: string) => Promise.resolve(key));
    const cache = createPromiseCache({ load });

    await Promise.all([cache.read("a"), cache.read("b")]);
    expect(cache.size()).toBe(2);

    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.has("a")).toBe(false);

    await expect(cache.read("a")).resolves.toBe("a");
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("caches by SameValueZero, so numeric keys work without stringifying", async () => {
    const load = vi.fn((key: number) => Promise.resolve(key * 2));
    const cache = createPromiseCache({ load });

    await expect(cache.read(21)).resolves.toBe(42);
    void cache.read(21);

    expect(load).toHaveBeenCalledTimes(1);
  });
});
