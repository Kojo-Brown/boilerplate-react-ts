import type { ReactNode } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";

export interface MediaQueryProps {
  /** A CSS media query, e.g. `(min-width: 48rem)`. */
  query: string;
  /**
   * Called with the current match during this component's render.
   *
   * This is a render prop rather than a `ReactNode` slot: the value it needs
   * does not exist until the component has rendered, so the caller has to be
   * handed it rather than given a place to put something.
   */
  children: (matches: boolean) => ReactNode;
}

/**
 * The render-prop delivery of {@link useMediaQuery}.
 *
 * Kept as a worked example for `docs/render-props-and-hocs.md`, and kept
 * *thin* on purpose — the whole component is one hook call and one function
 * call, because a render prop is a way of handing a value to a caller and not
 * a place to keep an implementation.
 *
 * Written today, this would be a hook at the call site and nothing else. It is
 * here for the two cases where that is not available:
 *
 * - **A class component.** Hooks cannot be called from one, and a class is
 *   still the only way to write an error boundary — see `ErrorBoundary`.
 * - **A caller that must consume the value conditionally**, e.g. deep inside a
 *   branch a hook cannot legally sit in.
 *
 * Both are narrow, and the second comes with a trap that costs more than it
 * saves. See "Hooks inside a render prop" in the doc: the function below is
 * invoked during *this* component's render, so hooks called inside it attach
 * to this fiber. Render it conditionally and their count changes between
 * renders — the caller's code is fine in isolation and React throws in a
 * component the caller did not write. `MediaQuery.test.tsx` pins that.
 */
export function MediaQuery({ query, children }: MediaQueryProps) {
  const matches = useMediaQuery(query);
  return <>{children(matches)}</>;
}
