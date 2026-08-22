import type { ComponentType } from "react";

/**
 * The two chores every higher-order component owes its wrapper, and neither of
 * which React does for it.
 *
 * A HOC returns a *new* component. Everything the original carried that was
 * not a prop — its name in React DevTools, and any static property hung off
 * it — belongs to the original and does not follow the wrapper out. Both
 * losses are silent: the tree still renders, so the only symptom is a devtools
 * panel full of anonymous nodes and, for statics, a `TypeError` at whatever
 * call site was reaching for one.
 *
 * See `docs/render-props-and-hocs.md` for when a HOC is the right delivery at
 * all. Most are better as hooks; the ones that survive are the ones that put
 * something *above* the component — a boundary, a provider — which is a place
 * a hook cannot reach from inside.
 */

/**
 * React's own statics, which belong to the wrapper rather than to the thing it
 * wraps. Copying `displayName` in particular would make every wrapper claim to
 * be its inner component, which is precisely the confusion the wrapper name is
 * supposed to resolve.
 */
type ReactStatic =
  | "displayName"
  | "propTypes"
  | "defaultProps"
  | "contextType"
  | "contextTypes"
  | "childContextTypes"
  | "getDerivedStateFromProps"
  | "getDerivedStateFromError"
  | "type"
  | "render"
  | "compare";

/**
 * Own properties every function has. Copying these throws in strict mode
 * (`length` and `name` are non-writable) or corrupts the wrapper (`prototype`,
 * `caller`, `arguments`).
 */
type FunctionStatic = "length" | "name" | "prototype" | "caller" | "arguments" | "callee";

/** What survives a hoist: the source's own statics, minus the two sets above. */
export type HoistedStatics<TSource> = Omit<TSource, ReactStatic | FunctionStatic>;

/*
 * The runtime sets are declared against the same unions the type uses, so a
 * name added to one and not the other fails `pnpm typecheck` rather than
 * producing a helper whose documented behaviour and actual behaviour differ.
 */
const REACT_STATICS: ReadonlySet<ReactStatic> = new Set<ReactStatic>([
  "displayName",
  "propTypes",
  "defaultProps",
  "contextType",
  "contextTypes",
  "childContextTypes",
  "getDerivedStateFromProps",
  "getDerivedStateFromError",
  "type",
  "render",
  "compare",
]);

const FUNCTION_STATICS: ReadonlySet<FunctionStatic> = new Set<FunctionStatic>([
  "length",
  "name",
  "prototype",
  "caller",
  "arguments",
  "callee",
]);

function isSkipped(key: string): boolean {
  return (
    REACT_STATICS.has(key as ReactStatic) ||
    FUNCTION_STATICS.has(key as FunctionStatic) ||
    // Set by `memo`, `forwardRef`, context objects and every other React
    // element type. Copying it turns a plain function into something React
    // tries to render as that element type instead.
    key === "$$typeof"
  );
}

/** A component's name for devtools, falling back through the ways it can be spelled. */
export function getDisplayName<TProps>(Component: ComponentType<TProps> | string): string {
  if (typeof Component === "string") return Component;
  const name = Component.displayName ?? Component.name;
  // An arrow function assigned to nothing has `name === ""`, which devtools
  // renders as a blank node rather than falling back on its own.
  return name === "" ? "Component" : name;
}

/**
 * The wrapper's devtools name: `withMediaQuery(PricingTable)`.
 *
 * Worth the two lines because the default is actively misleading. A wrapper
 * declared as `function WithMediaQuery()` shows up as `WithMediaQuery` for
 * every component it is ever applied to, so a tree with four of them shows
 * four identical nodes and no way to tell which is which.
 */
export function wrapDisplayName<TProps>(
  Component: ComponentType<TProps> | string,
  hocName: string,
): string {
  return `${hocName}(${getDisplayName(Component)})`;
}

/**
 * Copy the wrapped component's own statics onto the wrapper.
 *
 * Statics are rare in this codebase and deliberately so — `createTabs()`
 * exists because compound components hung off statics cannot share the root's
 * type parameter (see `Tabs.tsx`) — so the case this exists for is a HOC
 * applied to a component from somewhere else, where dropping
 * `Component.Fragment` or a `navigationOptions` the framework reads is a
 * failure at a call site nobody changed.
 *
 * Symbol-keyed statics are copied too. They are how a library marks its own
 * types, and a wrapper that loses the mark stops being recognised by the
 * library that made it.
 */
export function copyStatics<TTarget extends object, TSource extends object>(
  target: TTarget,
  source: TSource,
): TTarget & HoistedStatics<TSource> {
  const keys: (string | symbol)[] = [
    ...Object.getOwnPropertyNames(source),
    ...Object.getOwnPropertySymbols(source),
  ];

  for (const key of keys) {
    if (typeof key === "string" && isSkipped(key)) continue;

    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor === undefined) continue;

    try {
      Object.defineProperty(target, key, descriptor);
    } catch {
      // A non-configurable property already on the target cannot be
      // redefined. Losing one static is better than failing the render that
      // was only trying to name a component.
    }
  }

  /*
   * `target` genuinely does carry the copied statics now, but the assignment
   * happened through `defineProperty` and TypeScript tracks nothing across
   * that. The assertion states the postcondition rather than hiding a mistake;
   * `hoc.test.ts` is what checks it, including that the skipped keys really
   * are absent.
   */
  return target as TTarget & HoistedStatics<TSource>;
}
