import path from "node:path";
import type { Rule } from "eslint";

/**
 * The Feature-Sliced Design import-boundary rule.
 *
 * `docs/feature-sliced-design.md` is the prose; this file is the enforcement.
 * Four things are checked, and each exists because the corresponding mistake is
 * invisible without it — the code compiles, the tests pass, and the layout is
 * quietly no longer what the directory names claim:
 *
 * 1. **Layer order.** A module may import from layers strictly below its own.
 * 2. **Slice isolation.** Inside a sliced layer, one slice may not reach into
 *    another. Slices are the unit that can be deleted or moved on its own, and
 *    a single sideways import is what takes that away.
 * 3. **Every file in a sliced layer lives in a slice**, so there is no drawer
 *    of loose modules that belongs to no feature.
 * 4. **Nothing ships that imports test scaffolding.** `src/test/` is not a
 *    layer: it may read from anywhere, and only test files may read from it.
 *
 * `import type` is exempt from (1) and (2). This is not a softening, it is the
 * line the rule is actually drawing: a type import is erased before a module
 * graph exists, so it cannot put a higher layer in a lower layer's bundle,
 * create a runtime cycle, or make a slice fail to load without its sibling. It
 * *is* still coupling — a `RootState` that changes shape still breaks whoever
 * described it — but it is coupling the type checker reports in full, which is
 * the opposite of the failure mode this rule exists to catch. `src/shared/store/hooks.ts`
 * is the deliberate use.
 */

/** Layers in dependency order: index 0 may be imported by everything above it. */
export const LAYERS = ["shared", "entities", "features", "widgets", "pages", "app"] as const;

export type Layer = (typeof LAYERS)[number];

/**
 * Layers divided into slices — one directory per feature, entity or page.
 *
 * `shared` and `app` are deliberately absent. Neither is sliced: `shared` is
 * divided into segments (`ui`, `lib`, `api`, `config`…) that describe *what a
 * module is* rather than what it is about, and `app` is a single composition
 * root. Segments may reference each other; slices may not.
 */
export const SLICED_LAYERS = new Set<Layer>(["entities", "features", "widgets", "pages"]);

/** Directory under `src/` holding test scaffolding, which is not a layer. */
export const TEST_ROOT = "test";

const LAYER_RANK = new Map<string, number>(LAYERS.map((l, i) => [l, i]));

type Placement =
  | { kind: "test" }
  | { kind: "outside" }
  | { kind: "unknown"; root: string }
  | { kind: "layer"; layer: Layer; slice: string | null };

/**
 * Path of `absolute` relative to the source root, or `null` when it is outside.
 *
 * The root is found by looking for the last path segment named exactly `src`
 * rather than by resolving against the working directory, so the rule behaves
 * the same under ESLint, under `RuleTester`, and from any subdirectory.
 */
export function toSourceRelative(absolute: string): string | null {
  const parts = absolute.split(path.sep).filter(Boolean);
  const index = parts.lastIndexOf("src");
  if (index === -1 || index === parts.length - 1) return null;
  return parts.slice(index + 1).join("/");
}

/** Where a source-relative path sits in the architecture. */
export function place(sourceRelative: string | null): Placement {
  if (sourceRelative === null) return { kind: "outside" };
  const parts = sourceRelative.split("/");
  const root = parts[0] ?? "";
  if (root === TEST_ROOT) return { kind: "test" };
  if (!LAYER_RANK.has(root)) return { kind: "unknown", root };
  const layer = root as Layer;
  if (!SLICED_LAYERS.has(layer)) return { kind: "layer", layer, slice: null };
  // `features/auth/LoginForm.tsx` is in a slice; `features/LoginForm.tsx` is not.
  const slice = parts.length > 2 ? (parts[1] ?? null) : null;
  return { kind: "layer", layer, slice };
}

/** Resolves an import specifier to a source-relative path, or `null`. */
export function resolveSpecifier(specifier: string, fromFile: string): string | null {
  if (specifier.startsWith("@/")) return specifier.slice(2);
  if (specifier.startsWith(".")) {
    return toSourceRelative(path.resolve(path.dirname(fromFile), specifier));
  }
  return null;
}

const TEST_FILE = /\.test\.tsx?$/;

/**
 * The parts of an import or export statement this rule reads.
 *
 * `importKind` and `exportKind` come from the TypeScript ESTree extension and
 * are absent from the `estree` types, so the node is read through this shape
 * rather than its declared one. Every field is `unknown`: the rule must behave
 * on whatever a parser hands it, not assume the extension is present.
 */
interface ImportMeta {
  readonly importKind?: unknown;
  readonly exportKind?: unknown;
  readonly specifiers?: readonly { readonly importKind?: unknown }[];
  readonly source?: { readonly value?: unknown } | null;
}

function meta(node: Rule.Node): ImportMeta {
  return node as ImportMeta;
}

/**
 * True when nothing this statement brings in survives to runtime.
 *
 * Both spellings count — `import type { A } from …` and
 * `import { type A, type B } from …` — because they compile to the same
 * nothing. A statement with no specifiers at all (`import "./x.css"`) is a
 * side-effect import and is emphatically not type-only.
 */
export function isTypeOnly(node: Rule.Node): boolean {
  const { importKind, exportKind, specifiers } = meta(node);
  if (importKind === "type" || exportKind === "type") return true;
  if (specifiers === undefined || specifiers.length === 0) return false;
  return specifiers.every((s) => s.importKind === "type");
}

export const layerImports: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce Feature-Sliced Design layer order, slice isolation and test-utility containment",
      url: "https://github.com/Kojo-Brown/boilerplate-react-ts/blob/main/docs/feature-sliced-design.md",
    },
    schema: [],
    messages: {
      upward:
        "`{{from}}` may not import from `{{to}}`: {{fromLayer}} sits below {{toLayer}}. Move the shared part down to a lower layer, or invert the dependency by passing it in. (`import type` is allowed here — see docs/feature-sliced-design.md.)",
      crossSlice:
        "`{{from}}` may not import from `{{to}}`: {{fromSlice}} and {{toSlice}} are sibling slices of `{{layer}}`, and a slice has to be movable on its own. Move what they share down a layer.",
      sliceless:
        "Every file in `{{layer}}` belongs to a slice, but `{{from}}` sits directly in the layer directory. Put it in `{{layer}}/<slice>/`.",
      unknownRoot:
        "`{{root}}` is not a Feature-Sliced layer. Files under `src/` belong to one of: {{layers}}, or to `src/test/`.",
      testUtility:
        "`{{from}}` imports `{{to}}`, which is test scaffolding. `src/test/` may only be imported by test files — anything else ships it.",
    },
  },

  create(context) {
    const filename = context.filename;
    const selfRelative = toSourceRelative(filename);
    const self = place(selfRelative);
    if (self.kind === "outside") return {};

    const isTest = TEST_FILE.test(filename) || self.kind === "test";

    if (self.kind === "unknown") {
      return {
        Program(node) {
          context.report({
            node,
            messageId: "unknownRoot",
            data: { root: self.root, layers: LAYERS.join(", ") },
          });
        },
      };
    }

    // A sliceless file in a sliced layer is reported once, on the file itself:
    // its imports are still checked below against the layer it is in.
    const slicelessLayer =
      self.kind === "layer" && SLICED_LAYERS.has(self.layer) && self.slice === null
        ? self.layer
        : null;

    function check(node: Rule.Node, specifier: string): void {
      const target = resolveSpecifier(specifier, filename);
      if (target === null) return;
      const to = place(target);
      if (to.kind === "outside") return;

      if (to.kind === "test") {
        if (!isTest) {
          context.report({
            node,
            messageId: "testUtility",
            data: { from: selfRelative ?? filename, to: target },
          });
        }
        return;
      }
      // Test scaffolding is above every layer by design: it exists to drive
      // the application, so it is the one place allowed to reach anywhere.
      if (self.kind !== "layer") return;
      if (to.kind === "unknown") return;
      if (isTypeOnly(node)) return;

      const fromRank = LAYER_RANK.get(self.layer) ?? 0;
      const toRank = LAYER_RANK.get(to.layer) ?? 0;

      if (toRank > fromRank) {
        context.report({
          node,
          messageId: "upward",
          data: {
            from: selfRelative ?? filename,
            to: target,
            fromLayer: self.layer,
            toLayer: to.layer,
          },
        });
        return;
      }

      if (
        toRank === fromRank &&
        SLICED_LAYERS.has(self.layer) &&
        self.slice !== null &&
        to.slice !== null &&
        self.slice !== to.slice
      ) {
        context.report({
          node,
          messageId: "crossSlice",
          data: {
            from: selfRelative ?? filename,
            to: target,
            layer: self.layer,
            fromSlice: self.slice,
            toSlice: to.slice,
          },
        });
      }
    }

    function fromSource(node: Rule.Node): void {
      const value = meta(node).source?.value;
      if (typeof value === "string") check(node, value);
    }

    return {
      Program(node) {
        if (slicelessLayer !== null) {
          context.report({
            node,
            messageId: "sliceless",
            data: { from: selfRelative ?? filename, layer: slicelessLayer },
          });
        }
      },
      ImportDeclaration: fromSource,
      ExportNamedDeclaration: fromSource,
      ExportAllDeclaration: fromSource,
      // `lazy(() => import("@/pages/…"))` is a real edge; it is how the router
      // reaches every page, and it would otherwise be the one way past this rule.
      ImportExpression(node) {
        const { source } = node;
        if (source.type === "Literal" && typeof source.value === "string") {
          check(node, source.value);
        }
      },
    };
  },
};

export const fsdPlugin = {
  rules: { "layer-imports": layerImports },
};
