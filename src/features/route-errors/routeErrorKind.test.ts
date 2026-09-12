import { describe, it, expect, vi } from "vitest";
import {
  RELOAD_GUARD_KEY,
  RELOAD_GUARD_WINDOW_MS,
  classifyRouteError,
  isChunkLoadError,
  tryClaimReload,
} from "@/features/route-errors/routeErrorKind";

describe("isChunkLoadError", () => {
  it.each([
    [
      "Chromium",
      "Failed to fetch dynamically imported module: https://app.test/assets/Dashboard-4f21ab.js",
    ],
    [
      "Firefox",
      "error loading dynamically imported module: https://app.test/assets/Dashboard-4f21ab.js",
    ],
    ["WebKit", "Importing a module script failed."],
    ["Vite's preload helper", "Unable to preload CSS for /assets/Dashboard-4f21ab.css"],
    [
      "an HTML error page served in place of the chunk",
      'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html".',
    ],
  ])("recognises the %s spelling", (_engine, message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it("recognises webpack's ChunkLoadError by name, for a migrated project", () => {
    const error = new Error("Loading chunk 42 failed.");
    error.name = "ChunkLoadError";
    expect(isChunkLoadError(error)).toBe(true);
  });

  it("matches case-insensitively, engines disagreeing on capitalisation", () => {
    expect(
      isChunkLoadError(new TypeError("FAILED TO FETCH DYNAMICALLY IMPORTED MODULE: /a.js")),
    ).toBe(true);
  });

  it("does not claim an ordinary render error", () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined"))).toBe(false);
  });

  it("does not claim an ordinary network failure", () => {
    // A failed `fetch` is retryable in place; a failed module import is not,
    // and conflating them would swap the wrong recovery in for both.
    expect(isChunkLoadError(new TypeError("Failed to fetch"))).toBe(false);
  });

  it.each([[null], [undefined], ["a string"], [42]])("survives %s", (thrown) => {
    expect(isChunkLoadError(thrown)).toBe(false);
  });

  it("reads a message off a non-Error object", () => {
    expect(isChunkLoadError({ message: "error loading dynamically imported module: /a.js" })).toBe(
      true,
    );
  });
});

describe("classifyRouteError", () => {
  it("labels a stale chunk", () => {
    expect(
      classifyRouteError(new TypeError("Failed to fetch dynamically imported module: /a.js")),
    ).toBe("chunk-load");
  });

  it("labels everything else as a render error", () => {
    expect(classifyRouteError(new Error("undefined is not a function"))).toBe("render");
  });
});

describe("tryClaimReload", () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      read: (key: string) => map.get(key) ?? null,
    };
  }

  it("allows the first reload and records when it happened", () => {
    const storage = memoryStorage();
    expect(tryClaimReload({ storage, now: () => 1_000 })).toBe(true);
    expect(storage.read(RELOAD_GUARD_KEY)).toBe("1000");
  });

  it("refuses a second reload inside the window, so a broken deploy cannot loop the tab", () => {
    const storage = memoryStorage();
    tryClaimReload({ storage, now: () => 1_000 });
    expect(tryClaimReload({ storage, now: () => 1_000 + RELOAD_GUARD_WINDOW_MS - 1 })).toBe(false);
  });

  it("allows another reload once the window has passed", () => {
    const storage = memoryStorage();
    tryClaimReload({ storage, now: () => 1_000 });
    expect(tryClaimReload({ storage, now: () => 1_000 + RELOAD_GUARD_WINDOW_MS + 1 })).toBe(true);
  });

  it("ignores a corrupt stored value rather than refusing forever", () => {
    const storage = memoryStorage({ [RELOAD_GUARD_KEY]: "not-a-number" });
    expect(tryClaimReload({ storage, now: () => 5_000 })).toBe(true);
  });

  it("allows the reload when storage throws, as it does in a private window", () => {
    const hostile = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    // Refusing every reload would break recovery outright; the loop this
    // guards against needs a broken deployment *as well as* a missing guard.
    expect(tryClaimReload({ storage: hostile, now: () => 1 })).toBe(true);
  });

  it("allows the reload where there is no storage at all", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(tryClaimReload({ now: () => 1 })).toBe(true);
    vi.unstubAllGlobals();
  });
});
