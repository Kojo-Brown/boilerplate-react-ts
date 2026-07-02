import { describe, it, expect } from "vitest";
import { ROUTES, typedRoute } from "@/router/paths";

describe("ROUTES", () => {
  it("defines the expected route paths", () => {
    expect(ROUTES.HOME).toBe("/");
    expect(ROUTES.DASHBOARD).toBe("/dashboard");
    expect(ROUTES.ABOUT).toBe("/about");
    expect(ROUTES.LOGIN).toBe("/login");
  });
});

describe("typedRoute", () => {
  it("returns the same path it receives", () => {
    expect(typedRoute("/")).toBe("/");
    expect(typedRoute("/dashboard")).toBe("/dashboard");
    expect(typedRoute("/about")).toBe("/about");
    expect(typedRoute("/login")).toBe("/login");
  });
});
