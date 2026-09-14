import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildGraph, type Manifest } from "../bundleBudget/graph.ts";

/**
 * What the service worker precaches, computed from the build it will serve.
 *
 * The list cannot be written by hand: every file in it carries a content hash
 * that changes on the commit that changes the file. It also cannot be "every
 * JS file in `dist/`" — that is thirty-six chunks, of which twenty are lazy
 * routes the user may never visit, and precaching them all means a first visit
 * that downloads the entire application before it is usable.
 *
 * What it is instead is exactly the initial graph: the entry chunk, everything
 * it statically imports, the stylesheets those pull in, and the shell. That is
 * the set the browser blocks on for the first render, which makes it the set
 * that has to be present for the application to open with no network. Lazy
 * routes are then cached as they are visited, by the runtime strategy — a
 * route the user has been to works offline, and one they have not does not.
 * `docs/offline.md` is explicit about that boundary, because it is the one
 * thing about this design a user can notice.
 *
 * `tooling/bundleBudget/graph.ts` already knows how to walk that graph, and
 * this reuses it rather than restating it. The two answering the same question
 * differently would be worse than either being wrong: the budget would then be
 * measuring a set the worker does not precache.
 */
export interface PrecachePlan {
  /** Root-relative URLs, shell first. */
  readonly urls: readonly string[];
  /**
   * Identifies this build's precache.
   *
   * Derived from the URL list and the shell's contents, so it changes when and
   * only when the precache's contents change — which means a rebuild that
   * changes nothing reuses the cache instead of re-downloading it, and a
   * rebuild that changes one chunk gets a new cache under a new name. A
   * timestamp or a commit SHA would both be wrong here, in opposite ways: the
   * first invalidates a cache that is still correct, the second fails to
   * invalidate one that is not (a dependency bump changes the assets without
   * changing the SHA the application was built from).
   */
  readonly buildId: string;
}

/** The URL the shell is precached under; must match `APP_SHELL_URL`. */
export const SHELL_URL = "/index.html";

export function planPrecache(input: {
  readonly manifest: Manifest;
  readonly shellHtml: string;
  readonly extraUrls?: readonly string[];
}): PrecachePlan {
  const graph = buildGraph(input.manifest);
  // The shell is added by hand because the manifest does not describe it: the
  // `index.html` key maps to the entry *chunk* (`assets/index-<hash>.js`), and
  // the HTML file itself appears nowhere in the graph.
  const urls = new Set<string>([SHELL_URL]);
  for (const chunk of graph.initialChunks) urls.add(toUrl(chunk.file));
  for (const css of graph.initialCss) urls.add(toUrl(css));
  for (const extra of input.extraUrls ?? []) urls.add(extra);

  const sorted = [...urls];
  const digest = createHash("sha256");
  for (const url of [...sorted].sort()) digest.update(`${url}\n`);
  digest.update(input.shellHtml);

  return { urls: sorted, buildId: digest.digest("hex").slice(0, 12) };
}

function toUrl(file: string): string {
  return file.startsWith("/") ? file : `/${file}`;
}

/**
 * Reads a completed build and plans its precache.
 *
 * Throws rather than degrading when the build output is missing. The failure
 * mode this prevents is a worker that ships with an empty precache: it
 * installs, activates, controls every page, and serves nothing offline —
 * a feature that is switched off with no error anywhere.
 */
export function readPrecachePlan(distDir: string): PrecachePlan {
  const manifestPath = path.join(distDir, ".vite", "manifest.json");
  const shellPath = path.join(distDir, "index.html");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `No build manifest at ${manifestPath}. The service worker is built from the application build — run \`vite build\` first.`,
    );
  }
  if (!existsSync(shellPath)) {
    throw new Error(`No application shell at ${shellPath}.`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  return planPrecache({ manifest, shellHtml: readFileSync(shellPath, "utf8") });
}
