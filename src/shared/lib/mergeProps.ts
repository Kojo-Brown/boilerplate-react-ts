import type { Ref } from "react";
import { cn } from "@/shared/lib/cn";

/**
 * The plumbing behind a prop getter.
 *
 * A headless hook hands its behaviour to the caller as `getSomethingProps()`,
 * and the caller almost always has props of their own for the same element —
 * a `className`, their own `onClick`, a `ref` they need for measurement. The
 * naive implementations both lose something silently:
 *
 * ```tsx
 * <li {...getOptionProps(value)} onClick={track} />   // hook's onClick gone
 * <li onClick={track} {...getOptionProps(value)} />   // caller's onClick gone
 * ```
 *
 * Neither produces an error. The element renders, looks right, and one of the
 * two behaviours is simply absent. `mergeProps` is why the getter takes the
 * caller's props as an argument instead: it composes the pairs that can be
 * composed rather than letting spread order decide which one survives.
 */

/** Anything that can be spread onto a DOM element or component. */
export type PropsRecord = Record<string, unknown>;

/** What {@link mergeRefs} returns: a ref callback that always cleans up. */
export type MergedRefCallback<T> = (node: T | null) => () => void;

/**
 * The result of {@link mergeProps}: the hook's props, with the caller's
 * winning any key they both set.
 *
 * The obvious spelling, `TBase & TCaller`, is unusable. TypeScript reduces an
 * intersection to `never` as soon as one property has incompatible types in
 * the two halves — so `getOptionProps(value, { onClick: undefined })` would
 * not merely mistype `onClick`, it would make the whole returned object
 * `never` and every other prop on it an error. `Omit` keeps the two halves
 * from ever meeting.
 *
 * One deliberate imprecision: a merged `ref` is reported as the caller's ref
 * type even though the value is a callback merging both. Both spread onto the
 * same element, and the caller's own ref is still populated, so the only thing
 * the type hides is a `ref` nobody reads through this object.
 */
export type MergedProps<TBase extends PropsRecord, TCaller extends PropsRecord> = Omit<
  TBase,
  keyof TCaller
> &
  TCaller;

/**
 * The default `TCaller`: no keys at all.
 *
 * `PropsRecord` would be the obvious default and it erases the result —
 * `Omit<TBase, string>` is `{}`, so `getListboxProps()` with no argument would
 * hand back an object whose every property is `unknown`.
 */
export type NoCallerProps = Record<never, never>;

/**
 * Events whose hook-side handler the caller has opted out of.
 *
 * A `WeakSet` keyed on the event object rather than a property written onto
 * it: React 19 no longer pools synthetic events, so mutation would work, but a
 * `WeakSet` keeps the marker out of anything that inspects or serialises the
 * event, and it costs nothing to let the entry die with the event.
 */
const hookDefaultPrevented = new WeakSet();

/**
 * Suppresses the hook's own handler for this one event.
 *
 * Call it from a handler passed *into* a prop getter, before the hook's
 * behaviour would run:
 *
 * ```tsx
 * <li
 *   {...getOptionProps(option.value, {
 *     onClick: (event) => {
 *       if (option.value === "custom") {
 *         preventHookDefault(event); // open our own editor instead of selecting
 *         openEditor();
 *       }
 *     },
 *   })}
 * />
 * ```
 *
 * **Why not `event.preventDefault()`.** Overloading the DOM's own cancel flag
 * is the tempting shortcut and it is wrong in a way that only bites later.
 * `preventDefault()` on a keydown is how you stop the page scrolling under an
 * ArrowDown, and a caller who calls it for that reason has said nothing at all
 * about wanting the hook's key handling turned off — but the hook would read
 * `defaultPrevented` and go quiet, leaving arrow keys dead with no error to
 * chase. The two intentions need two flags. (Downshift reaches the same
 * conclusion with its `preventDownshiftDefault` marker.)
 */
export function preventHookDefault(event: object): void {
  hookDefaultPrevented.add(event);
}

/** Whether {@link preventHookDefault} was called for this event. */
export function isHookDefaultPrevented(event: unknown): boolean {
  return typeof event === "object" && event !== null && hookDefaultPrevented.has(event);
}

type AnyHandler = (...args: never[]) => unknown;

/** `onClick`, `onKeyDown` — but not `only` or `once`. */
const HANDLER_NAME = /^on[A-Z]/;

/**
 * Runs the caller's handler, then the hook's — unless the caller opted out.
 *
 * The order is deliberate and it is the only one that makes
 * {@link preventHookDefault} usable: the caller has to get the event while the
 * decision is still open. Running the hook first would mean the selection has
 * already changed by the time the caller is asked whether it should.
 *
 * The cost is that a caller's handler observes the state *before* the hook
 * acts on the event. That is the right trade for a veto and the wrong one for
 * "tell me what was selected" — which is what `onValueChange` is for.
 */
function chainHandlers(callerHandler: AnyHandler, hookHandler: AnyHandler): AnyHandler {
  return (...args: never[]): void => {
    callerHandler(...args);
    if (isHookDefaultPrevented(args[0])) return;
    hookHandler(...args);
  };
}

function isRef(value: unknown): value is Ref<unknown> {
  return typeof value === "function" || (typeof value === "object" && value !== null);
}

/**
 * Merges the props a hook produces with the props its caller supplied.
 *
 * The caller's value wins for anything that cannot be combined. Four kinds can
 * be, and are:
 *
 * - **`on*` handlers** — chained, caller first, subject to
 *   {@link preventHookDefault}.
 * - **`className`** — merged through `cn`, so Tailwind conflicts resolve the
 *   caller's way rather than by string order.
 * - **`style`** — shallow-merged, caller's declarations last.
 * - **`ref`** — merged through {@link mergeRefs}; both refs see the node.
 *
 * A caller value of `undefined` is treated as "not supplied" and leaves the
 * hook's value in place. `onClick={undefined}` is what an optional prop looks
 * like when it was not passed down, so reading it as "remove the hook's click
 * handling" would break behaviour from a prop the caller never set.
 */
export function mergeProps<TBase extends PropsRecord, TCaller extends PropsRecord = NoCallerProps>(
  base: TBase,
  caller: TCaller | undefined,
): MergedProps<TBase, TCaller> {
  if (!caller) return base as MergedProps<TBase, TCaller>;

  const merged: PropsRecord = { ...base };

  for (const [key, callerValue] of Object.entries(caller)) {
    if (callerValue === undefined) continue;

    const baseValue = merged[key];

    if (baseValue === undefined) {
      merged[key] = callerValue;
    } else if (HANDLER_NAME.test(key) && typeof baseValue === "function") {
      merged[key] =
        typeof callerValue === "function"
          ? chainHandlers(callerValue as AnyHandler, baseValue as AnyHandler)
          : callerValue;
    } else if (key === "className") {
      merged[key] = cn(baseValue, callerValue);
    } else if (key === "style") {
      merged[key] = { ...(baseValue as object), ...(callerValue as object) };
    } else if (key === "ref" && isRef(baseValue) && isRef(callerValue)) {
      merged[key] = mergeRefs(baseValue, callerValue);
    } else {
      merged[key] = callerValue;
    }
  }

  return merged as MergedProps<TBase, TCaller>;
}

/**
 * Points several refs at one node.
 *
 * A prop getter that needs a ref of its own — and a virtually-focused listbox
 * does, because it has to scroll the active option into view itself — cannot
 * just set `ref` in the props it returns. That silently replaces the caller's.
 *
 * **React 19's cleanup contract is the subtle part.** A ref callback may now
 * return a cleanup function, and React changes its own behaviour when one does:
 * it stops calling the callback a second time with `null` on unmount. So a
 * merged callback, which must return a cleanup in order to unwind the refs
 * that do have one, takes on responsibility for the refs that do not — it has
 * to null out object refs and call plain callback refs with `null` itself.
 * Forget that and a ref keeps a detached node alive for as long as whatever
 * holds the ref lives.
 *
 * The return type is narrower than `RefCallback<T>` — always a cleanup, never
 * `void` — because that is what this always produces, and saying so spares
 * callers a `typeof cleanup === "function"` guard they can never fail.
 */
export function mergeRefs<T>(...refs: readonly (Ref<T> | undefined)[]): MergedRefCallback<T> {
  return (node: T | null) => {
    const cleanups: (() => void)[] = [];

    for (const ref of refs) {
      if (typeof ref === "function") {
        const result = ref(node);
        cleanups.push(
          typeof result === "function"
            ? result
            : () => {
                ref(null);
              },
        );
      } else if (ref) {
        ref.current = node;
        cleanups.push(() => {
          ref.current = null;
        });
      }
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  };
}
