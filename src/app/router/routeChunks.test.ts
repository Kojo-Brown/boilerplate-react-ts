import { describe, it, expect } from "vitest";
import { routeChunks, SLOW_ROUTE_PATH } from "@/app/router/routeChunks";
import { ROUTES } from "@/shared/routes/paths";

describe("routeChunks", () => {
  it("has a loader for every named route", () => {
    // The registry is what a link prefetches through, and `request()` silently
    // drops an href it has no loader for — correctly, since not every link
    // points at a lazy route. That makes a forgotten entry invisible: the new
    // page still loads, just never early. This is the check that would have
    // said so.
    const missing = Object.values(ROUTES).filter((href) => !(href in routeChunks));
    expect(missing).toEqual([]);
  });

  it("covers the navigation lab's unnamed destination", () => {
    expect(SLOW_ROUTE_PATH in routeChunks).toBe(true);
  });

  it("holds thunks rather than promises", () => {
    // An `import()` written without the arrow would run at module scope and
    // eagerly download every route, which is the opposite of code splitting
    // and would still leave every test here passing.
    for (const [href, loader] of Object.entries(routeChunks)) {
      expect(typeof loader, href).toBe("function");
      expect(loader.length, href).toBe(0);
    }
  });
});
