import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // `e2e/` holds Playwright specs; running them under Vitest throws
    // "Playwright Test did not expect test.describe() to be called here".
    // `.tsbuildinfo/` holds tsc -b output, including compiled copies of the
    // Playwright specs; collecting either form throws inside Vitest.
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**", ".tsbuildinfo/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html", "lcov"],
      reportsDirectory: "./coverage",
      // `all` was removed in Vitest 4; `include` alone now covers untested files.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/test/**",
        "src/main.tsx",
        "src/env.ts",
        "src/**/*.d.ts",
        "src/**/*.stories.{ts,tsx}",
        "src/types/**",
        "src/router/**",
        "src/styles/**",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
        "src/lib/**": {
          lines: 90,
          functions: 90,
          branches: 85,
          statements: 90,
        },
        "src/hooks/**": {
          lines: 85,
          functions: 85,
          branches: 80,
          statements: 85,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
