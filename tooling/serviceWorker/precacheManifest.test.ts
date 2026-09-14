// @vitest-environment node
//
// Nothing here renders; the suite reads a build manifest and a directory.
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { planPrecache, readPrecachePlan, SHELL_URL } from "./precacheManifest.ts";
import type { Manifest } from "../bundleBudget/graph.ts";

/**
 * The same shape as this repository's real manifest: the HTML entry's key is
 * `index.html` while its `file` is the entry chunk, manual chunks are reached
 * through `imports`, and routes through `dynamicImports`.
 */
const manifest: Manifest = {
  "index.html": {
    file: "assets/index-aaaaaaaa.js",
    name: "index",
    isEntry: true,
    imports: ["_router-bbbbbbbb.js", "_vendor-cccccccc.js"],
    dynamicImports: ["src/pages/home/HomePage.tsx"],
    css: ["assets/index-dddddddd.css"],
  },
  "_router-bbbbbbbb.js": { file: "assets/router-bbbbbbbb.js", name: "router" },
  "_vendor-cccccccc.js": { file: "assets/vendor-cccccccc.js", name: "vendor" },
  "src/pages/home/HomePage.tsx": {
    file: "assets/HomePage-eeeeeeee.js",
    name: "HomePage",
    isDynamicEntry: true,
    imports: ["index.html"],
  },
};

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function buildDir(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "precache-"));
  tempDirs.push(dir);
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(dir, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return dir;
}

describe("planPrecache", () => {
  it("precaches the shell and the initial graph", () => {
    const plan = planPrecache({ manifest, shellHtml: "<!doctype html>" });
    expect(plan.urls).toEqual([
      SHELL_URL,
      "/assets/index-aaaaaaaa.js",
      "/assets/vendor-cccccccc.js",
      "/assets/router-bbbbbbbb.js",
      "/assets/index-dddddddd.css",
    ]);
  });

  it("leaves lazy routes out", () => {
    // Precaching all thirty-six chunks would make the first visit download the
    // whole application before it is usable. A route the user has visited works
    // offline because the runtime strategy cached it; one they have not, does
    // not — and `docs/offline.md` says so explicitly, because it is the one
    // thing about this design a user can notice.
    const plan = planPrecache({ manifest, shellHtml: "<!doctype html>" });
    expect(plan.urls).not.toContain("/assets/HomePage-eeeeeeee.js");
  });

  it("precaches the shell, which the manifest does not describe", () => {
    // The `index.html` key maps to the entry *chunk*, not to the HTML file, so
    // a plan built from the graph alone would precache every script the shell
    // needs and not the shell — and a navigation offline would find nothing to
    // answer with.
    const plan = planPrecache({ manifest, shellHtml: "<!doctype html>" });
    expect(plan.urls.filter((url) => url.endsWith(".html"))).toEqual([SHELL_URL]);
  });

  it("includes extra URLs the caller names", () => {
    const plan = planPrecache({
      manifest,
      shellHtml: "<!doctype html>",
      extraUrls: ["/favicon.svg"],
    });
    expect(plan.urls).toContain("/favicon.svg");
  });

  it("gives an identical build an identical id", () => {
    // A rebuild that changes nothing reuses the cache rather than making every
    // user download it again — which is what a timestamp or a commit SHA in
    // this position would do.
    const a = planPrecache({ manifest, shellHtml: "<!doctype html>" });
    const b = planPrecache({ manifest, shellHtml: "<!doctype html>" });
    expect(a.buildId).toBe(b.buildId);
  });

  it("changes the id when a chunk's content hash changes", () => {
    const changed: Manifest = {
      ...manifest,
      "_router-bbbbbbbb.js": { file: "assets/router-99999999.js", name: "router" },
    };
    const before = planPrecache({ manifest, shellHtml: "<!doctype html>" });
    const after = planPrecache({ manifest: changed, shellHtml: "<!doctype html>" });
    expect(after.buildId).not.toBe(before.buildId);
  });

  it("changes the id when only the shell changes", () => {
    // `index.html` is the one unhashed file in the build. Hashing the URL list
    // alone would leave an edited title serving out of the old precache
    // forever.
    const before = planPrecache({ manifest, shellHtml: "<!doctype html><title>A</title>" });
    const after = planPrecache({ manifest, shellHtml: "<!doctype html><title>B</title>" });
    expect(after.buildId).not.toBe(before.buildId);
  });

  it("does not depend on the order the manifest happens to be in", () => {
    const reordered: Manifest = {
      "_vendor-cccccccc.js": manifest["_vendor-cccccccc.js"] ?? { file: "" },
      "index.html": manifest["index.html"] ?? { file: "" },
      "_router-bbbbbbbb.js": manifest["_router-bbbbbbbb.js"] ?? { file: "" },
    };
    expect(planPrecache({ manifest: reordered, shellHtml: "<!doctype html>" }).buildId).toBe(
      planPrecache({
        manifest: {
          "index.html": manifest["index.html"] ?? { file: "" },
          "_router-bbbbbbbb.js": manifest["_router-bbbbbbbb.js"] ?? { file: "" },
          "_vendor-cccccccc.js": manifest["_vendor-cccccccc.js"] ?? { file: "" },
        },
        shellHtml: "<!doctype html>",
      }).buildId,
    );
  });
});

describe("readPrecachePlan", () => {
  it("reads a completed build", () => {
    const dir = buildDir({
      ".vite/manifest.json": JSON.stringify(manifest),
      "index.html": "<!doctype html>",
    });
    expect(readPrecachePlan(dir).urls).toContain("/assets/router-bbbbbbbb.js");
  });

  it("refuses to plan without a manifest", () => {
    // The failure this prevents is a worker that ships with an empty precache:
    // it installs, activates, controls every page, and serves nothing offline.
    const dir = buildDir({ "index.html": "<!doctype html>" });
    expect(() => readPrecachePlan(dir)).toThrow(/No build manifest/);
  });

  it("refuses to plan without a shell", () => {
    const dir = buildDir({ ".vite/manifest.json": JSON.stringify(manifest) });
    expect(() => readPrecachePlan(dir)).toThrow(/No application shell/);
  });
});
