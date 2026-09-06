// @vitest-environment node
//
// Nothing here renders; the suite reads a manifest shape and walks it.
import { describe, it, expect } from "vitest";
import { buildGraph, chunkName, type Manifest } from "./graph.ts";

/**
 * A manifest shaped like this repository's real one, small enough to reason
 * about. The details that matter and are easy to get wrong when writing a
 * fixture by hand:
 *
 * - the HTML entry's key is `index.html` while its `file` is the JS chunk;
 * - lazy chunks statically import the *entry* (Rollup hoists the shared graph
 *   into it), which is why every real lazy chunk lists `index.html`;
 * - a manual chunk is reached through `imports`, a route through
 *   `dynamicImports`, and the only difference in `dist/` is that one has a
 *   `<link rel="modulepreload">` and the other does not.
 */
const manifest: Manifest = {
  "index.html": {
    file: "assets/index-aaaaaaaa.js",
    name: "index",
    isEntry: true,
    imports: ["_router-bbbbbbbb.js", "_vendor-cccccccc.js"],
    dynamicImports: ["src/pages/login/LoginPage.tsx", "src/pages/home/HomePage.tsx"],
    css: ["assets/index-dddddddd.css"],
  },
  "_router-bbbbbbbb.js": {
    file: "assets/router-bbbbbbbb.js",
    name: "router",
    imports: ["_vendor-cccccccc.js"],
  },
  "_vendor-cccccccc.js": { file: "assets/vendor-cccccccc.js", name: "vendor" },
  "_forms-eeeeeeee.js": { file: "assets/forms-eeeeeeee.js", name: "forms" },
  "src/pages/login/LoginPage.tsx": {
    file: "assets/LoginPage-ffffffff.js",
    name: "LoginPage",
    isDynamicEntry: true,
    imports: ["index.html", "_router-bbbbbbbb.js", "_forms-eeeeeeee.js"],
    css: ["assets/LoginPage-99999999.css"],
  },
  "src/pages/home/HomePage.tsx": {
    file: "assets/HomePage-11111111.js",
    name: "HomePage",
    isDynamicEntry: true,
    imports: ["index.html", "_router-bbbbbbbb.js"],
  },
};

describe("buildGraph", () => {
  const graph = buildGraph(manifest);

  it("puts the entry and every chunk it statically imports in the initial graph", () => {
    expect(graph.initialChunks.map((c) => c.name).sort()).toEqual(["index", "router", "vendor"]);
  });

  it("keeps lazy routes out of the initial graph", () => {
    // The failure this pins is the whole reason the manifest is read at all:
    // `dist/assets/*.js` would have matched LoginPage and HomePage too, and
    // the budget would then grow with every route added.
    const names = graph.initialChunks.map((c) => c.name);
    expect(names).not.toContain("LoginPage");
    expect(names).not.toContain("HomePage");
  });

  it("collects stylesheets reached from the initial graph and no others", () => {
    expect(graph.initialCss).toEqual(["assets/index-dddddddd.css"]);
  });

  it("charges a lazy route for the shared chunks it drags in", () => {
    const login = graph.lazyRoutes.find((r) => r.name === "LoginPage");
    // `forms` is not in the initial graph, so a cold cache pays for it on the
    // way to /login. Reporting only `LoginPage-*.js` would understate the
    // navigation by the size of every shared chunk it pulls.
    expect(login?.files).toContain("assets/forms-eeeeeeee.js");
    expect(login?.files).toContain("assets/LoginPage-99999999.css");
  });

  it("does not charge a lazy route for chunks already in the initial graph", () => {
    const login = graph.lazyRoutes.find((r) => r.name === "LoginPage");
    // Both are reachable from LoginPage's `imports` — the entry because Rollup
    // hoists shared modules into it, the router because the page uses it — and
    // both are already downloaded before the route is ever requested.
    expect(login?.files).not.toContain("assets/index-aaaaaaaa.js");
    expect(login?.files).not.toContain("assets/router-bbbbbbbb.js");
  });

  it("charges a shared chunk to every route that needs it", () => {
    // Two routes sharing a chunk each pay for it on a cold cache, so
    // `lazy.largest` is a claim about one navigation rather than about the sum
    // of bytes on disk. Nothing here deduplicates across routes.
    const withForms = buildGraph({
      ...manifest,
      "src/pages/home/HomePage.tsx": {
        ...manifest["src/pages/home/HomePage.tsx"],
        file: "assets/HomePage-11111111.js",
        imports: ["index.html", "_forms-eeeeeeee.js"],
      },
    });
    const charged = withForms.lazyRoutes.filter((r) =>
      r.files.includes("assets/forms-eeeeeeee.js"),
    );
    expect(charged.map((r) => r.name).sort()).toEqual(["HomePage", "LoginPage"]);
  });

  it("accounts for every file the manifest names", () => {
    expect([...graph.emittedFiles].sort()).toEqual([
      "assets/HomePage-11111111.js",
      "assets/LoginPage-99999999.css",
      "assets/LoginPage-ffffffff.js",
      "assets/forms-eeeeeeee.js",
      "assets/index-aaaaaaaa.js",
      "assets/index-dddddddd.css",
      "assets/router-bbbbbbbb.js",
      "assets/vendor-cccccccc.js",
    ]);
  });

  it("terminates on a cyclic import graph", () => {
    // Rollup emits cycles between manual chunks routinely. A closure walk that
    // trusts the graph to be a tree hangs the build rather than failing it.
    const cyclic = buildGraph({
      "index.html": { file: "a.js", name: "a", isEntry: true, imports: ["b"] },
      b: { file: "b.js", name: "b", imports: ["index.html"] },
    });
    expect(cyclic.initialChunks.map((c) => c.name).sort()).toEqual(["a", "b"]);
  });

  it("ignores an import with no manifest entry", () => {
    const truncated = buildGraph({
      "index.html": { file: "a.js", name: "a", isEntry: true, imports: ["missing"] },
    });
    expect(truncated.initialChunks).toHaveLength(1);
  });

  it("finds nothing initial in a manifest with no entry", () => {
    const graphless = buildGraph({ "_x.js": { file: "x.js", name: "x" } });
    expect(graphless.initialChunks).toEqual([]);
    expect(graphless.emittedFiles.has("x.js")).toBe(true);
  });
});

describe("chunkName", () => {
  it("prefers Rollup's stable name over the content-addressed key", () => {
    expect(
      chunkName("_router-bbbbbbbb.js", { file: "assets/router-bbbbbbbb.js", name: "router" }),
    ).toBe("router");
  });

  it("falls back to the key when there is no name", () => {
    // Deliberately not a hash-stripping regex: getting the fallback wrong this
    // way changes the budget id and fails loudly, where a regex that trimmed
    // the wrong suffix would quietly map two chunks onto one budget.
    expect(chunkName("_odd.js", { file: "assets/odd.js" })).toBe("_odd.js");
    expect(chunkName("_odd.js", { file: "assets/odd.js", name: "" })).toBe("_odd.js");
  });
});
