import { describe, it, expect } from "vitest";
import type { UIMatch } from "react-router";
import {
  documentTitle,
  isRouteHandle,
  routeAnnouncement,
  routeTitleIdFromMatches,
} from "@/features/route-announcement/routeTitle";
import { APP_NAME } from "@/shared/config/app";
import { intlFor } from "@/test/intl";

function match(handle: unknown, id = "0"): UIMatch {
  return { id, pathname: "/", params: {}, data: undefined, loaderData: undefined, handle };
}

const en = intlFor("en-GB");
const ar = intlFor("ar-EG");

describe("isRouteHandle", () => {
  it.each([
    ["a handle with a known title id", { titleId: "route.about.title" }, true],
    ["a handle with extra keys", { titleId: "route.about.title", crumb: "x" }, true],
    /*
     * The id is checked against the catalogue, not merely for being a string.
     * `useMatches` erases the handle to `unknown`, so the compiler's guarantee
     * is gone by the time it arrives here — and a handle left behind by a
     * renamed message is a plausible string that would title a tab
     * `route.dashbord.title`.
     */
    ["a plausible but unknown id", { titleId: "route.nope.title" }, false],
    ["an empty id", { titleId: "" }, false],
    ["a non-string id", { titleId: 42 }, false],
    ["the old `title` shape", { title: "About" }, false],
    ["an object with no titleId", { crumb: "x" }, false],
    ["null", null, false],
    ["undefined", undefined, false],
    ["a bare string", "About", false],
  ])("%s", (_name, handle, expected) => {
    expect(isRouteHandle(handle)).toBe(expected);
  });
});

describe("routeTitleIdFromMatches", () => {
  it("takes the deepest handle, because the leaf knows what page this is", () => {
    const matches = [
      match({ titleId: "route.home.title" }, "0"),
      match({ titleId: "route.dashboard.title" }, "0-1"),
    ];
    expect(routeTitleIdFromMatches(matches)).toBe("route.dashboard.title");
  });

  it("skips layout routes that declare no handle", () => {
    // `ProtectedRoute` is exactly this: a pathless match between the shell and
    // the page, with nothing to call itself.
    const matches = [match({ titleId: "route.home.title" }), match(undefined), match(undefined)];
    expect(routeTitleIdFromMatches(matches)).toBe("route.home.title");
  });

  it("skips a malformed handle rather than announcing part of one", () => {
    const matches = [match({ titleId: "route.about.title" }), match({ titleId: 42 })];
    expect(routeTitleIdFromMatches(matches)).toBe("route.about.title");
  });

  it("returns null when nothing declares a title", () => {
    // Deliberately not derived from the path: a route that forgot its handle
    // is a bug `router.test.tsx` catches, and a plausible-looking title here
    // is what would let it survive.
    expect(routeTitleIdFromMatches([match(undefined)])).toBeNull();
  });

  it("returns null for no matches at all", () => {
    expect(routeTitleIdFromMatches([])).toBeNull();
  });
});

describe("documentTitle", () => {
  it("suffixes the product name", () => {
    expect(documentTitle(en, "route.dashboard.title")).toBe(`Dashboard · ${APP_NAME}`);
  });

  it("falls back to the bare product name", () => {
    expect(documentTitle(en, null)).toBe(APP_NAME);
  });

  it("titles the tab in the reader's language", () => {
    expect(documentTitle(ar, "route.dashboard.title")).toBe(`لوحة التحكم · ${APP_NAME}`);
  });

  it("leaves the product name untranslated", () => {
    // A brand is not a string to translate, and `APP_NAME` is interpolated
    // rather than duplicated into each catalogue so that cannot drift.
    expect(documentTitle(ar, null)).toBe(APP_NAME);
  });
});

describe("routeAnnouncement", () => {
  it("names the event, not just the page", () => {
    // A lone noun in a polite region is indistinguishable from a label read
    // out of the page.
    expect(routeAnnouncement(en, "route.about.title")).toBe("About, page loaded");
  });

  it("says nothing when the page has no name", () => {
    expect(routeAnnouncement(en, null)).toBe("");
  });

  it("announces in the reader's language, with the locale's own punctuation", () => {
    /*
     * The separator is `،` (U+060C), the Arabic comma, and not `,`. It is in the
     * translation rather than in the code, which is the whole reason this is one
     * message with a placeholder instead of a page name with a suffix appended.
     */
    expect(routeAnnouncement(ar, "route.about.title")).toBe("حول، تم تحميل الصفحة");
  });
});
