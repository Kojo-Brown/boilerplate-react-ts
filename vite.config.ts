import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { visualizer } from "rollup-plugin-visualizer";
import { reactCompilerBabelPlugin } from "./reactCompiler.config";

export default defineConfig(({ mode }) => ({
  plugins: [
    react({
      // The compiler runs as a Babel pass ahead of the JSX transform. In
      // `annotation` mode it only rewrites functions carrying `"use memo"`,
      // so this is a no-op for every file that has not opted in.
      babel: { plugins: [reactCompilerBabelPlugin] },
    }),
    tailwindcss(),
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
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          router: ["react-router"],
          query: ["@tanstack/react-query"],
          redux: ["@reduxjs/toolkit", "react-redux"],
        },
      },
    },
  },
}));
