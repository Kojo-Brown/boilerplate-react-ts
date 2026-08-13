import type { ComponentProps } from "react";
import { Link } from "react-router";
import { useTransitionLink } from "@/components/navigation/useTransitionLink";

export type TransitionLinkProps = ComponentProps<typeof Link>;

/**
 * `<Link>` that keeps the current page on screen while the next one loads.
 *
 * Still a real `<a href>` — the transition is only about which React update
 * the navigation lands in, and it is not worth giving up middle-click, "copy
 * link address", or the status bar to get it.
 *
 * `data-pending` marks the link the app is currently navigating to, so a
 * pressed nav item can show it is the one being waited on.
 *
 * The remaining props are spread through untouched rather than destructured
 * and re-passed: `exactOptionalPropertyTypes` makes an explicitly-`undefined`
 * prop a different type from an absent one, so re-passing them would force
 * every optional prop of `<Link>` to be reconstructed by presence.
 */
export function TransitionLink({ onClick, ...props }: TransitionLinkProps) {
  const { handleClick, isPendingTarget } = useTransitionLink({
    to: props.to,
    replace: props.replace,
    state: props.state,
    preventScrollReset: props.preventScrollReset,
    relative: props.relative,
    target: props.target,
    onClick,
  });

  return (
    <Link {...props} onClick={handleClick} data-pending={isPendingTarget ? "true" : undefined} />
  );
}
