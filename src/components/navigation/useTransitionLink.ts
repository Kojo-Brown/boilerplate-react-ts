import { useCallback, type MouseEvent } from "react";
import type { RelativeRoutingType, To } from "react-router";
import { useRouteTransition } from "@/router/routeTransition";
import { toHref } from "@/router/toHref";

export interface TransitionLinkOptions {
  to: To;
  replace?: boolean | undefined;
  state?: unknown;
  preventScrollReset?: boolean | undefined;
  relative?: RelativeRoutingType | undefined;
  /** Anchor target; anything but `_self` is left to the browser. */
  target?: string | undefined;
  onClick?: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
}

export interface TransitionLinkBehaviour {
  handleClick: (event: MouseEvent<HTMLAnchorElement>) => void;
  /** True when this link is the destination of the navigation being held. */
  isPendingTarget: boolean;
}

/**
 * A click that the browser is still entitled to handle itself.
 *
 * Modifier clicks and non-`_self` targets open a new tab or window, which is a
 * request for a *document* load — taking it over would break a control users
 * expect to work everywhere. Only a plain primary-button click is ours.
 */
function isBrowserOwnedClick(event: MouseEvent<HTMLAnchorElement>, target?: string): boolean {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    (target !== undefined && target !== "" && target !== "_self")
  );
}

/**
 * Click handling shared by `<TransitionLink>` and `<TransitionNavLink>`.
 *
 * Calling `preventDefault` is what hands the navigation over: React Router
 * composes a link's `onClick` ahead of its own handler and skips that handler
 * once the event has been default-prevented, so the same click cannot navigate
 * twice. Leaving the event alone is therefore the correct way to decline — the
 * router's ordinary navigation still runs, just without the held transition.
 */
export function useTransitionLink({
  to,
  replace,
  state,
  preventScrollReset,
  relative,
  target,
  onClick,
}: TransitionLinkOptions): TransitionLinkBehaviour {
  const { navigate, pendingHref } = useRouteTransition();

  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>): void => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      if (isBrowserOwnedClick(event, target)) return;

      event.preventDefault();
      // Built by presence rather than passed straight through: under
      // `exactOptionalPropertyTypes` an explicit `undefined` is not the same
      // as an absent key, and `NavigateOptions` only accepts the latter.
      navigate(to, {
        ...(replace !== undefined && { replace }),
        ...(state !== undefined && { state }),
        ...(preventScrollReset !== undefined && { preventScrollReset }),
        ...(relative !== undefined && { relative }),
      });
    },
    [onClick, target, navigate, to, replace, state, preventScrollReset, relative],
  );

  return { handleClick, isPendingTarget: pendingHref === toHref(to) };
}
