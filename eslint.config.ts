import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["dist", "coverage", "playwright-report", ".tsbuildinfo"]),
  {
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Provider components live alongside their consumer hook by design; the
      // hook is stable across edits so fast refresh is unaffected.
      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
          allowExportNames: ["useToast", "useAuth", "useTheme"],
        },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // Interpolating a number is safe and universally readable; the default
      // ban on it produces noise without catching real defects.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
      // JSX event handlers are fire-and-forget by design. Promise-returning
      // handlers still matter elsewhere, so only the attribute check is off.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    // Tests assert on values the type system cannot narrow (query results,
    // captured request bodies). Non-null assertions are the clearest tool there.
    files: ["**/*.test.{ts,tsx}", "src/test/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    // Playwright's `use` fixture callback is not a React hook; the
    // rules-of-hooks heuristic matches on the name alone.
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    // RTK Query spells "this endpoint takes no argument" as `void`
    // (`builder.mutation<void, void>`). The rule only honours
    // allowInGenericTypeArguments for type references, not for type arguments
    // on a call expression, so it misfires on every endpoint definition.
    files: ["**/*Api.ts"],
    rules: {
      "@typescript-eslint/no-invalid-void-type": "off",
    },
  },
  {
    // The `globals` package ships untyped global maps.
    files: ["eslint.config.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
);
