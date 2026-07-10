import { useCallback, useRef } from "react";

/**
 * Returns a referentially stable function that always delegates to the latest
 * version of `fn`. Safe to pass to useEffect deps without triggering re-runs
 * when `fn` changes identity on every render.
 */
export function useStableCallback<Args extends unknown[], Return>(
  fn: (...args: Args) => Return,
): (...args: Args) => Return {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  return useCallback((...args: Args) => fnRef.current(...args), []);
}
