import {
  TransitionNavLink,
  type TransitionNavLinkProps,
} from "@/features/route-transition/TransitionNavLink";
import {
  usePrefetchTriggers,
  type PrefetchTrigger,
} from "@/features/route-prefetch/usePrefetchTriggers";
import { mergeProps } from "@/shared/lib/mergeProps";
import { toHref } from "@/shared/routes/toHref";

export interface PrefetchNavLinkProps extends Omit<TransitionNavLinkProps, "ref" | "prefetch"> {
  /** Which signals start the prefetch. Defaults to `"hover"`. */
  prefetchOn?: PrefetchTrigger;
  /** Pointer dwell before a hover counts as intent. */
  prefetchDelayMs?: number;
  /** How far outside the viewport counts as approaching, for `"viewport"`. */
  prefetchRootMargin?: string;
}

/**
 * A nav link that warms its destination's chunk before the click.
 *
 * **Why this lives in `widgets/` rather than either feature.** It is the
 * composition of two sibling slices — `route-transition` owns the click,
 * `route-prefetch` owns the hover — and `fsd/layer-imports` forbids one slice
 * importing another precisely so neither becomes undeletable because of the
 * other. Composition of siblings belongs to the layer above them, and this is
 * the layer that has navigation in it.
 *
 * `ref` is omitted rather than forwarded: with `prefetch="viewport"` the
 * component owns the anchor's ref in order to observe it, and a component that
 * accepted a ref it might or might not honour depending on an unrelated prop
 * would be worse than one that does not accept it at all.
 *
 * The caller's pointer handlers are composed through `mergeProps` rather than
 * spread over — `{...triggers}` after `{...props}` would silently drop a
 * caller's `onPointerEnter`, and before it would drop the prefetch.
 * `className` is *not* routed through `mergeProps`: on a `NavLink` it is a
 * render function, and merging two of those through `cn` would produce a
 * string built from two function bodies.
 *
 * **React Router's own `prefetch` prop is omitted rather than passed on.** It
 * is in `NavLinkProps` and it type-checks, and in this app it does nothing:
 * `usePrefetchBehavior` reads `FrameworkContext` and returns `[false, ref, {}]`
 * when there is none, which is every app built on `createBrowserRouter` rather
 * than the framework's `HydratedRouter`. Even where it is live it emits
 * `<link rel="prefetch">` for route module URLs read out of the build
 * manifest, and library mode has no manifest. Leaving it accepted would offer
 * a prop that silently does nothing next to one that does — hence
 * `prefetchOn`, and hence the `Omit`.
 */
export function PrefetchNavLink({
  prefetchOn = "hover",
  prefetchDelayMs,
  prefetchRootMargin,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onTouchStart,
  ...props
}: PrefetchNavLinkProps) {
  const triggers = usePrefetchTriggers({
    href: toHref(props.to),
    trigger: prefetchOn,
    hoverDelayMs: prefetchDelayMs,
    rootMargin: prefetchRootMargin,
  });

  const anchorProps = mergeProps(triggers, {
    onPointerEnter,
    onPointerLeave,
    onFocus,
    onTouchStart,
  });

  return <TransitionNavLink {...props} {...anchorProps} />;
}
