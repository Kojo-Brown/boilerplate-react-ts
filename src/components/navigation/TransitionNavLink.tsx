import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { NavLink } from "react-router";
import { useTransitionLink } from "@/components/navigation/useTransitionLink";

type NavLinkProps = ComponentProps<typeof NavLink>;

/**
 * What the render props are handed.
 *
 * `isPendingTarget` rather than reusing React Router's `isPending`, which is
 * still passed through untouched and means something else: the router reports
 * pending only while a *loader* is running, and these routes have none — a
 * `React.lazy` chunk download leaves `isPending` false for its whole duration.
 * Two flags with the same name and different answers would be worse than one
 * long name.
 */
export interface TransitionNavLinkRenderProps {
  isActive: boolean;
  isPending: boolean;
  isTransitioning: boolean;
  isPendingTarget: boolean;
}

type Renderable<T> = T | ((props: TransitionNavLinkRenderProps) => T);

export interface TransitionNavLinkProps extends Omit<
  NavLinkProps,
  "className" | "style" | "children"
> {
  className?: Renderable<string | undefined>;
  style?: Renderable<CSSProperties | undefined>;
  children?: Renderable<ReactNode>;
}

function resolve<T>(value: Renderable<T>, bag: TransitionNavLinkRenderProps): T {
  return typeof value === "function"
    ? (value as (p: TransitionNavLinkRenderProps) => T)(bag)
    : value;
}

/** `<NavLink>` that navigates inside the app's route transition. */
export function TransitionNavLink({
  onClick,
  className,
  style,
  children,
  ...props
}: TransitionNavLinkProps) {
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
    <NavLink
      {...props}
      onClick={handleClick}
      data-pending={isPendingTarget ? "true" : undefined}
      className={(navProps) => resolve(className, { ...navProps, isPendingTarget })}
      style={(navProps) => resolve(style, { ...navProps, isPendingTarget })}
    >
      {(navProps) => resolve(children, { ...navProps, isPendingTarget })}
    </NavLink>
  );
}
