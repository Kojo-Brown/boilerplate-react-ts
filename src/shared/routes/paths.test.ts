import { describe, it, expect } from "vitest";
import { ROUTES, typedRoute } from "@/shared/routes/paths";

describe("ROUTES", () => {
  it("defines the expected route paths", () => {
    expect(ROUTES.HOME).toBe("/");
    expect(ROUTES.DASHBOARD).toBe("/dashboard");
    expect(ROUTES.ABOUT).toBe("/about");
    expect(ROUTES.CONCURRENCY_LAB).toBe("/labs/concurrency");
    expect(ROUTES.OPTIMISTIC_LAB).toBe("/labs/optimistic");
    expect(ROUTES.USE_API_LAB).toBe("/labs/use");
    expect(ROUTES.ACTIONS_LAB).toBe("/labs/actions");
    expect(ROUTES.STREAMING_LAB).toBe("/labs/streaming");
    expect(ROUTES.NAVIGATION_LAB).toBe("/labs/navigation");
    expect(ROUTES.HEADLESS_LAB).toBe("/labs/headless");
    expect(ROUTES.RENDER_PROPS_LAB).toBe("/labs/render-props");
    expect(ROUTES.DEPENDENCY_INVERSION_LAB).toBe("/labs/dependency-inversion");
    expect(ROUTES.WORKER_LAB).toBe("/labs/workers");
    expect(ROUTES.LOGIN).toBe("/login");
  });
});

describe("typedRoute", () => {
  it("returns the same path it receives", () => {
    expect(typedRoute("/")).toBe("/");
    expect(typedRoute("/dashboard")).toBe("/dashboard");
    expect(typedRoute("/about")).toBe("/about");
    expect(typedRoute("/labs/concurrency")).toBe("/labs/concurrency");
    expect(typedRoute("/labs/optimistic")).toBe("/labs/optimistic");
    expect(typedRoute("/labs/use")).toBe("/labs/use");
    expect(typedRoute("/labs/actions")).toBe("/labs/actions");
    expect(typedRoute("/labs/streaming")).toBe("/labs/streaming");
    expect(typedRoute("/labs/navigation")).toBe("/labs/navigation");
    expect(typedRoute("/labs/headless")).toBe("/labs/headless");
    expect(typedRoute("/labs/render-props")).toBe("/labs/render-props");
    expect(typedRoute("/labs/dependency-inversion")).toBe("/labs/dependency-inversion");
    expect(typedRoute("/labs/workers")).toBe("/labs/workers");
    expect(typedRoute("/login")).toBe("/login");
  });
});
