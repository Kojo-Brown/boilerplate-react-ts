import { describe, it, expect } from "vitest";
import type { UIMatch } from "react-router";
import {
  documentTitle,
  isRouteHandle,
  routeAnnouncement,
  routeTitleFromMatches,
} from "@/features/route-announcement/routeTitle";
import { APP_NAME } from "@/shared/config/app";

function match(handle: unknown, id = "0"): UIMatch {
  return { id, pathname: "/", params: {}, data: undefined, loaderData: undefined, handle };
}

describe("isRouteHandle", () => {
  it.each([
    ["a handle with a title", { title: "About" }, true],
    ["a handle with extra keys", { title: "About", crumb: "x" }, true],
    ["an empty title", { title: "" }, false],
    ["a non-string title", { title: 42 }, false],
    ["an object with no title", { crumb: "x" }, false],
    ["null", null, false],
    ["undefined", undefined, false],
    ["a bare string", "About", false],
  ])("%s", (_name, handle, expected) => {
    expect(isRouteHandle(handle)).toBe(expected);
  });
});

describe("routeTitleFromMatches", () => {
  it("takes the deepest handle, because the leaf knows what page this is", () => {
    const matches = [match({ title: "Shell" }, "0"), match({ title: "Dashboard" }, "0-1")];
    expect(routeTitleFromMatches(matches)).toBe("Dashboard");
  });

  it("skips layout routes that declare no handle", () => {
    // `ProtectedRoute` is exactly this: a pathless match between the shell and
    // the page, with nothing to call itself.
    const matches = [match({ title: "Shell" }), match(undefined), match(undefined)];
    expect(routeTitleFromMatches(matches)).toBe("Shell");
  });

  it("skips a malformed handle rather than announcing part of one", () => {
    const matches = [match({ title: "About" }), match({ title: 42 })];
    expect(routeTitleFromMatches(matches)).toBe("About");
  });

  it("returns null when nothing declares a title", () => {
    // Deliberately not derived from the path: a route that forgot its handle
    // is a bug `router.test.tsx` catches, and a plausible-looking title here
    // is what would let it survive.
    expect(routeTitleFromMatches([match(undefined)])).toBeNull();
  });

  it("returns null for no matches at all", () => {
    expect(routeTitleFromMatches([])).toBeNull();
  });
});

describe("documentTitle", () => {
  it("suffixes the product name", () => {
    expect(documentTitle("Dashboard")).toBe(`Dashboard · ${APP_NAME}`);
  });

  it("falls back to the bare product name", () => {
    expect(documentTitle(null)).toBe(APP_NAME);
  });
});

describe("routeAnnouncement", () => {
  it("names the event, not just the page", () => {
    // A lone noun in a polite region is indistinguishable from a label read
    // out of the page.
    expect(routeAnnouncement("About")).toBe("About, page loaded");
  });

  it("says nothing when the page has no name", () => {
    expect(routeAnnouncement(null)).toBe("");
  });
});
