import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { readPrecachePlan } from "./tooling/serviceWorker/precacheManifest";

/**
 * The second build: the service worker.
 *
 * A worker is a separate program with its own entry point, and three of its
 * requirements are ones the application build cannot satisfy at the same time:
 *
 * - **Its filename may not be hashed.** A worker's scope is capped by the
 *   directory it is served from, so `/assets/sw-B4kQ1x.js` could only control
 *   `/assets/`. It has to be `/sw.js`, at the root, under a name the previous
 *   build used too — which is also what lets the browser recognise an update
 *   as an update rather than as a different worker.
 * - **It may not be an ES module.** `type: "module"` workers are supported in
 *   current Chromium, Firefox and Safari, but a `module` registration fails
 *   outright on an engine that does not, and there is nothing to gain: the
 *   worker is one self-contained bundle either way. `iife` works everywhere.
 * - **It needs the application build to already exist**, because what it
 *   precaches is that build's own hashed assets. Hence the ordering in
 *   `package.json`, and hence `readPrecachePlan` throwing rather than emitting
 *   a worker with an empty precache.
 *
 * `emptyOutDir: false` is load-bearing in the other direction: this build
 * writes into the directory the previous one produced, and Vite's default is
 * to clear it first.
 */
const plan = readPrecachePlan(fileURLToPath(new URL("./dist", import.meta.url)));

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  define: {
    __PRECACHE_URLS__: JSON.stringify(plan.urls),
    __SW_BUILD_ID__: JSON.stringify(plan.buildId),
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    // The worker has no `index.html`; copying `public/` again would be a
    // second pass over files the application build already placed.
    copyPublicDir: false,
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      input: fileURLToPath(new URL("./src/app/sw/sw.ts", import.meta.url)),
      output: {
        entryFileNames: "sw.js",
        format: "iife",
        inlineDynamicImports: true,
      },
    },
  },
});
