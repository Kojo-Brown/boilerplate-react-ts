import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Returns a referentially stable function that always delegates to the latest
 * version of `fn`. Safe to pass to useEffect deps without triggering re-runs
 * when `fn` changes identity on every render.
 *
 * ## Why the ref is written in an effect and not during render
 *
 * The obvious implementation assigns `fnRef.current = fn` straight in the
 * function body. That is a Rules of React violation — writing a ref during
 * render makes the render impure, and `react-hooks/refs` reports it. It is not
 * a theoretical complaint: under `<StrictMode>` or a re-render React throws
 * away, the ref keeps a write from a render that never committed.
 *
 * `useLayoutEffect` is the fix, and the layout phase specifically: it flushes
 * synchronously after commit, before the browser paints and therefore before
 * any user event can reach the returned callback. A passive `useEffect` would
 * leave a window in which an event fires against the previous `fn`.
 *
 * ## Why this is not `useEffectEvent`
 *
 * React 19.2 ships `useEffectEvent`, which is the first-class version of this
 * pattern and should be preferred **when you can call it directly inside the
 * component that needs it**. It cannot be used to implement this hook:
 * `react-hooks/rules-of-hooks` rejects returning an Effect Event from a custom
 * hook with "React Hook 'useEffectEvent' can only be called at the top level of
 * your component. It cannot be passed down." That restriction is the whole
 * point of Effect Events — they are not values that travel.
 *
 * So: reach for `useEffectEvent` in a component; reach for this hook when the
 * stable callback has to be produced by a shared abstraction.
 *
 * ## Boundary
 *
 * Between render and the layout effect, the callback still sees the *previous*
 * `fn`. Calling it during render is therefore not supported (and calling any
 * callback during render is its own Rules of React violation). It is intended
 * for event handlers, effects, and subscriptions — all of which run after
 * commit. `useStableCallback.test.ts` pins this boundary.
 */
export function useStableCallback<Args extends unknown[], Return>(
  fn: (...args: Args) => Return,
): (...args: Args) => Return {
  const fnRef = useRef(fn);

  useLayoutEffect(() => {
    fnRef.current = fn;
  });

  return useCallback((...args: Args) => fnRef.current(...args), []);
}
