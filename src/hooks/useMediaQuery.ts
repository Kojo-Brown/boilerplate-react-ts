import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query.
 *
 * This is the modern equivalent of `react-media`'s `<Media query>{matches =>
 * …}</Media>` and of a `withMediaQuery(Component)` HOC, and it is the shape
 * `docs/render-props-and-hocs.md` translates both of those into. The other two
 * still exist in this codebase — `<MediaQuery>` and `withMediaQuery` — but
 * both are twelve-line adapters over this function rather than second
 * implementations of it, which is the point the doc is making: a capability
 * has one implementation, and delivery mechanisms are how it is handed to a
 * caller.
 *
 * ## Why `useSyncExternalStore` rather than `useEffect` + `useState`
 *
 * The obvious implementation — hold `matches` in state, subscribe in an
 * effect — is wrong in two ways that are invisible until they are not:
 *
 * 1. **The first render reports the wrong answer.** State initialised from
 *    `matchMedia(query).matches` is read once, at mount, and any change
 *    arriving between that read and the effect attaching is lost — the
 *    subscription starts after the value it was supposed to be watching has
 *    already moved. `useSyncExternalStore` re-reads the snapshot when it
 *    subscribes and again on every commit, so the window does not exist.
 * 2. **Concurrent renders can tear.** With state, two components reading the
 *    same query during one interrupted render can commit different answers.
 *    `useSyncExternalStore` exists to make that impossible, which is why React
 *    ships it rather than leaving subscriptions to effects.
 *
 * `ThemeContext` still uses the effect-and-state form for
 * `prefers-color-scheme`. It is not converted here — that is a behaviour
 * change to the theme system, not part of documenting these patterns — but it
 * is the obvious next caller.
 */
export function useMediaQuery(query: string): boolean {
  /*
   * `subscribe` must be referentially stable or the subscription is torn down
   * and rebuilt on every render — `useSyncExternalStore` re-subscribes
   * whenever this function's identity changes. Nothing about that failure is
   * visible: the hook keeps reporting the right value, it just does so after
   * removing and re-adding a listener on every commit. `useMediaQuery.test.ts`
   * counts `addEventListener` calls across re-renders rather than trusting it.
   */
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onStoreChange);
      return () => {
        list.removeEventListener("change", onStoreChange);
      };
    },
    [query],
  );

  /*
   * Each call builds its own `MediaQueryList`. That is deliberate rather than
   * wasteful: the object is a live view derived from the query string, so any
   * instance reports the same `matches`, and keeping one around in a ref would
   * add a cache to invalidate for no gain. What must *not* differ between the
   * two closures is the query itself, which is why both depend on it.
   */
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  /*
   * The server snapshot. This app is client-rendered today, so this arm is
   * unreachable — but `useSyncExternalStore` requires it under a server
   * renderer, and there is no honest answer other than "no match": a query is
   * a statement about a viewport, and the server has none. Reporting `false`
   * means server output matches the narrow arm of every query, so a
   * mobile-first component tree is the one that hydrates without a jump.
   */
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
