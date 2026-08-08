import { describe, it, expect } from "vitest";
import { ROUTES, typedRoute } from "@/router/paths";

describe("ROUTES", () => {
  it("defines the expected route paths", () => {
    expect(ROUTES.HOME).toBe("/");
    expect(ROUTES.DASHBOARD).toBe("/dashboard");
    expect(ROUTES.ABOUT).toBe("/about");
    expect(ROUTES.CONCURRENCY_LAB).toBe("/labs/concurrency");
    expect(ROUTES.OPTIMISTIC_LAB).toBe("/labs/optimistic");
    expect(ROUTES.USE_API_LAB).toBe("/labs/use");
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
    expect(typedRoute("/login")).toBe("/login");
  });
});
