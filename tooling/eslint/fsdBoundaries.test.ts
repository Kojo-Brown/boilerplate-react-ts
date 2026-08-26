// @vitest-environment node
//
// `RuleTester` parses and lints source strings; there is no DOM in sight, and
// the default jsdom environment only slows it down.
import { describe, it, expect } from "vitest";
import { Linter, RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import {
  LAYERS,
  SLICED_LAYERS,
  fsdPlugin,
  layerImports,
  isTypeOnly,
  place,
  resolveSpecifier,
  toSourceRelative,
} from "./fsdBoundaries";

/**
 * Every case below is written as source the rule is asked to judge, rather
 * than as a call to a helper, because the thing being tested is a decision
 * about a real import statement — including how it is spelled. `import type
 * { A }` and `import { type A }` are the same decision and different syntax,
 * and only one of those is visible to a helper taking a path.
 */
const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser as unknown as NonNullable<
      ConstructorParameters<typeof RuleTester>[0]
    >["languageOptions"] extends { parser?: infer P }
      ? P
      : never,
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

const AT = (p: string) => `/proj/src/${p}`;

describe("fsd/layer-imports", () => {
  ruleTester.run("layer-imports", layerImports, {
    valid: [
      {
        name: "downward: a page uses a feature",
        filename: AT("pages/login/LoginPage.tsx"),
        code: `import { LoginForm } from "@/features/auth/LoginForm";`,
      },
      {
        name: "downward: a feature uses an entity and shared",
        filename: AT("features/auth/AuthContext.tsx"),
        code: `
          import { authSlice } from "@/entities/session/authSlice";
          import { cn } from "@/shared/lib/cn";
        `,
      },
      {
        name: "app may reach every layer",
        filename: AT("app/router/index.tsx"),
        code: `
          import { RootLayout } from "@/widgets/layout/RootLayout";
          import { NotFoundPage } from "@/pages/not-found/NotFoundPage";
          import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
        `,
      },
      {
        name: "shared is segmented, not sliced: segments may reference each other",
        filename: AT("shared/ui/SelectMenu.tsx"),
        code: `import { useListbox } from "@/shared/hooks/useListbox";`,
      },
      {
        name: "same slice, whatever the depth",
        filename: AT("features/checkout/CartStep.tsx"),
        code: `import { checkoutMachine } from "@/features/checkout/checkoutMachine";`,
      },
      {
        name: "relative imports inside a slice resolve to the same slice",
        filename: AT("features/checkout/CartStep.tsx"),
        code: `import { checkoutMachine } from "./checkoutMachine";`,
      },
      {
        name: "`import type` may cross upward — it is erased before any bundle exists",
        filename: AT("shared/store/hooks.ts"),
        code: `import type { AppDispatch, RootState } from "@/app/store";`,
      },
      {
        name: "an all-inline type import is the same erasure",
        filename: AT("features/auth/silentRefresh.ts"),
        code: `import { type AppStore } from "@/app/store";`,
      },
      {
        name: "a test file may pull in test scaffolding",
        filename: AT("features/auth/LoginForm.test.tsx"),
        code: `import { renderWithProviders } from "@/test/renderWithProviders";`,
      },
      {
        name: "src/test itself may reach any layer: it exists to drive the app",
        filename: AT("test/renderWithProviders.tsx"),
        code: `
          import { store } from "@/app/store";
          import { authSlice } from "@/entities/session/authSlice";
        `,
      },
      {
        name: "dynamic import downward is how the router lazy-loads pages",
        filename: AT("app/router/index.tsx"),
        code: `const Home = lazy(() => import("@/pages/home/HomePage"));`,
      },
      {
        name: "a package import is none of the rule's business",
        filename: AT("shared/ui/Button.tsx"),
        code: `import { clsx } from "clsx";`,
      },
      {
        name: "files outside src/ are ignored entirely",
        filename: "/proj/e2e/login.spec.ts",
        code: `import { store } from "@/app/store";`,
      },
    ],

    invalid: [
      {
        name: "upward: shared may not reach a feature",
        filename: AT("shared/ui/Button.tsx"),
        code: `import { useAuth } from "@/features/auth/AuthContext";`,
        errors: [{ messageId: "upward" }],
      },
      {
        name: "upward: an entity may not reach the app's store singleton",
        filename: AT("entities/session/usePersistedSession.ts"),
        code: `import { store } from "@/app/store";`,
        errors: [{ messageId: "upward" }],
      },
      {
        name: "upward: a widget may not reach a page",
        filename: AT("widgets/layout/RootLayout.tsx"),
        code: `import { RouteFallback } from "@/app/router/RouteFallback";`,
        errors: [{ messageId: "upward" }],
      },
      {
        name: "upward through a re-export is still upward",
        filename: AT("shared/store/hooks.ts"),
        code: `export { store } from "@/app/store";`,
        errors: [{ messageId: "upward" }],
      },
      {
        name: "upward through a dynamic import is still upward",
        filename: AT("entities/user/profileApi.ts"),
        code: `const load = () => import("@/features/auth/AuthContext");`,
        errors: [{ messageId: "upward" }],
      },
      {
        name: "a side-effect import has no specifiers and is not type-only",
        filename: AT("shared/lib/cn.ts"),
        code: `import "@/features/auth/AuthContext";`,
        errors: [{ messageId: "upward" }],
      },
      {
        name: "sideways: one feature slice may not reach another",
        filename: AT("features/checkout/CheckoutFlow.tsx"),
        code: `import { useAuth } from "@/features/auth/AuthContext";`,
        errors: [{ messageId: "crossSlice" }],
      },
      {
        name: "sideways: one entity slice may not reach another",
        filename: AT("entities/report/reportApi.ts"),
        code: `import { profileApi } from "@/entities/user/profileApi";`,
        errors: [{ messageId: "crossSlice" }],
      },
      {
        name: "sideways via a relative path is the same import",
        filename: AT("entities/report/reportApi.ts"),
        code: `import { profileApi } from "../user/profileApi";`,
        errors: [{ messageId: "crossSlice" }],
      },
      {
        name: "a file in a sliced layer that belongs to no slice",
        filename: AT("pages/StrayPage.tsx"),
        code: `export const StrayPage = () => null;`,
        errors: [{ messageId: "sliceless" }],
      },
      {
        name: "a directory under src/ that is not a layer",
        filename: AT("utils/misc.ts"),
        code: `export const misc = 1;`,
        errors: [{ messageId: "unknownRoot" }],
      },
      {
        name: "production code may not import test scaffolding",
        filename: AT("features/auth/LoginForm.tsx"),
        code: `import { makeUser } from "@/test/factories";`,
        errors: [{ messageId: "testUtility" }],
      },
      {
        name: "…and a type-only import of it is still shipping test code's shape",
        filename: AT("features/auth/LoginForm.tsx"),
        code: `import type { TestStore } from "@/test/renderWithProviders";`,
        errors: [{ messageId: "testUtility" }],
      },
      {
        name: "one statement per violation, so a file reports all of them",
        filename: AT("shared/lib/cn.ts"),
        code: `
          import { useAuth } from "@/features/auth/AuthContext";
          import { HomePage } from "@/pages/home/HomePage";
        `,
        errors: [{ messageId: "upward" }, { messageId: "upward" }],
      },
    ],
  });

  it("names the file, the import and which way round the layers go", () => {
    // Driven through `Linter` rather than `RuleTester` so this also exercises
    // the shape `eslint.config.ts` registers the rule in — a plugin object
    // under a namespace — and reports the message a developer actually reads.
    const linter = new Linter();
    const messages = linter.verify(
      `import { store } from "@/app/store";`,
      {
        // `files` is required: a flat config with none applies to `.js` only,
        // so a `.ts` file would find no matching configuration.
        files: ["**/*.ts"],
        plugins: { fsd: fsdPlugin },
        languageOptions: { parser: tseslint.parser, sourceType: "module" },
        rules: { "fsd/layer-imports": "error" },
      },
      // Relative to the linter's base path, so the flat config applies at all.
      "src/entities/user/profileApi.ts",
    );

    expect(messages).toHaveLength(1);
    const [message] = messages;
    expect(message.ruleId).toBe("fsd/layer-imports");
    expect(message.message).toContain(
      "`entities/user/profileApi.ts` may not import from `app/store`",
    );
    expect(message.message).toContain("entities sits below app");
  });
});

describe("the architecture the rule encodes", () => {
  it("orders the layers from most general to most specific", () => {
    // Pinned rather than asserted loosely: reordering this list silently
    // redefines every "upward" judgement the rule makes.
    expect(LAYERS).toEqual(["shared", "entities", "features", "widgets", "pages", "app"]);
  });

  it("slices the four layers that hold domain code, and neither bookend", () => {
    expect([...SLICED_LAYERS].sort()).toEqual(["entities", "features", "pages", "widgets"]);
    expect(SLICED_LAYERS.has("shared")).toBe(false);
    expect(SLICED_LAYERS.has("app")).toBe(false);
  });
});

describe("path handling", () => {
  it("finds the source root by path segment, not by substring", () => {
    // A repository checked out at a path containing `src` as part of a longer
    // name must not be mistaken for the source root.
    expect(toSourceRelative("/home/dev/my-srcs/proj/src/shared/lib/cn.ts")).toBe(
      "shared/lib/cn.ts",
    );
    expect(toSourceRelative("/home/dev/proj/e2e/login.spec.ts")).toBeNull();
    expect(toSourceRelative("/home/dev/proj/src")).toBeNull();
  });

  it("classifies a path by its first two segments", () => {
    expect(place("features/auth/LoginForm.tsx")).toEqual({
      kind: "layer",
      layer: "features",
      slice: "auth",
    });
    expect(place("shared/ui/Button.tsx")).toEqual({
      kind: "layer",
      layer: "shared",
      slice: null,
    });
    expect(place("test/factories.ts")).toEqual({ kind: "test" });
    expect(place("utils/misc.ts")).toEqual({ kind: "unknown", root: "utils" });
    expect(place(null)).toEqual({ kind: "outside" });
  });

  it("resolves both spellings of an in-repo import and ignores packages", () => {
    const from = "/proj/src/entities/report/reportApi.ts";
    expect(resolveSpecifier("@/shared/lib/cn", from)).toBe("shared/lib/cn");
    expect(resolveSpecifier("./reportCache", from)).toBe("entities/report/reportCache");
    expect(resolveSpecifier("../user/profileApi", from)).toBe("entities/user/profileApi");
    expect(resolveSpecifier("react", from)).toBeNull();
  });

  it("reads a side-effect import as a value import", () => {
    expect(isTypeOnly({ type: "ImportDeclaration", specifiers: [] } as never)).toBe(false);
  });
});
