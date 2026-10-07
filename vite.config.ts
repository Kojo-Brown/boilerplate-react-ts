import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { visualizer } from "rollup-plugin-visualizer";
import { reactCompilerBabelPlugin } from "./reactCompiler.config";
import { csp } from "./tooling/csp/vitePlugin.ts";

export default defineConfig(({ mode }) => ({
  plugins: [
    react({
      // The compiler runs as a Babel pass ahead of the JSX transform. In
      // `annotation` mode it only rewrites functions carrying `"use memo"`,
      // so this is a no-op for every file that has not opted in.
      babel: { plugins: [reactCompilerBabelPlugin] },
    }),
    tailwindcss(),
    /*
      The Content-Security-Policy, which is a build concern in this application
      and not only a server one.

      Two things only the build knows. The nonce has to appear on every tag
      Vite generates, which is what `html.cspNonce` does and what this plugin
      turns on; and `connect-src` has to name the same origins `VITE_API_URL`
      and friends were inlined into the bundle as, which is what it emits to
      `dist/.csp/policy.conf` for the server to include. It also enforces the
      policy on the dev and preview servers, so the one that ships has been run
      by a browser. See `docs/csp.md`.
    */
    csp(),
    mode === "analyze" &&
      visualizer({
        filename: "stats.html",
        template: "treemap",
        gzipSize: true,
        brotliSize: true,
        open: !process.env.CI,
      }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL ?? "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: true,
    // Emits `dist/.vite/manifest.json`, which `pnpm bundle:budget` reads.
    // Nothing at runtime consumes it — this app has no server rendering the
    // HTML — but it is the only artefact that still knows which imports were
    // static and which were `import()`, and that distinction is the whole
    // difference between "what the browser blocks on" and "what is in dist/".
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          router: ["react-router"],
          query: ["@tanstack/react-query"],
          redux: ["@reduxjs/toolkit", "react-redux"],
          /*
            Split for cacheability, not to move a number.

            `react-intl` and the three `@formatjs` packages under it are the
            i18n *runtime* — the ICU parser and the formatter wrappers — and they
            are in the initial graph because `<IntlProvider>` wraps the
            application. They change on their own release cadence rather than
            with this codebase, so a separate chunk means an app deploy does not
            invalidate 17kB of stable library in every returning reader's cache,
            the same reason `router` and `redux` are split.

            It buys nothing on first load and `initial.js` is budgeted to say so:
            per-chunk ceilings can always be met by splitting a chunk in two, so
            the sum is what the gate actually holds. See `docs/bundle-budget.md`.

            The message catalogues are *not* here. `en-GB` is linked statically
            because it is the fallback and a fallback that has to be fetched is
            not one; every other locale is an `import()` and gets its own chunk
            on demand.

            `react-intl` alone, not its `@formatjs` dependencies: an object-form
            `manualChunks` entry names *entry modules*, which have to resolve
            from the project root, and under pnpm a transitive package does not.
            Naming the one direct dependency is enough — Rollup follows its
            static imports into the same chunk, which is where `@formatjs/intl`,
            `intl-messageformat` and the ICU parser land.
          */
          intl: ["react-intl"],
        },
      },
    },
  },
}));
