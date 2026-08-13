import { describe, it, expect } from "vitest";
import { toHref } from "@/router/toHref";

describe("toHref", () => {
  it("passes a string destination through unchanged", () => {
    expect(toHref("/about?tab=team")).toBe("/about?tab=team");
  });

  it("serialises a partial path so it can be compared to a link's destination", () => {
    // A link's `to` and the pending destination have to be comparable, and one
    // of them may be an object while the other is the string a link renders.
    expect(toHref({ pathname: "/about", search: "?tab=team" })).toBe("/about?tab=team");
  });

  it("serialises a hash", () => {
    expect(toHref({ pathname: "/about", hash: "#team" })).toBe("/about#team");
  });
});
