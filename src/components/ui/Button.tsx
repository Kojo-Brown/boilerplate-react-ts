import type { ElementType, MouseEvent } from "react";
import { cn } from "@/lib/cn";
import type { PolymorphicProps } from "@/lib/polymorphic";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

/**
 * The props `Button` adds on top of whichever element `as` names.
 *
 * `disabled` is declared here, as one of the component's own props, rather
 * than being left to arrive from the element. That is deliberate and it is the
 * substance of making this component polymorphic:
 *
 * - `loading` implies disabled, and `loading` is meaningful on every element
 *   `as` can name — but `disabled` is an attribute of `button`, `input`,
 *   `fieldset`, `select`, `optgroup`, `option` and `textarea` and nothing
 *   else. `<Button as={Link} loading>` would otherwise forward
 *   `disabled={true}` to an anchor.
 * - That forward fails *silently*. React treats `disabled` as a known
 *   property and writes it to any element it is given, so the anchor renders
 *   `<a disabled="">`, which no browser has ever honoured: the link still
 *   focuses, still activates on Enter, and still navigates, while looking
 *   disabled. No warning is logged at any point.
 *
 * Owning the prop is what lets the component pick the mechanism that actually
 * works for the element it turned out to be rendering. See
 * {@link disabledPropsFor}.
 */
export interface ButtonOwnProps {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  /**
   * Declared here, and typed as a string, for the same reason `disabled` is
   * declared here: the component composes it rather than forwarding it.
   *
   * With `TElement` open at `ElementType`, the element's own `className` is an
   * unresolved generic — which reaches `cn()` as `any` and takes the
   * `no-unsafe-argument` lint rule with it. Owning the prop is also a small
   * deliberate narrowing: react-router's `Link` accepts a function for
   * `className`, and `<Button as={Link} className={fn}>` is rejected here
   * because `cn` merges strings. Callers needing that form want `Link`
   * directly, not a button that happens to navigate.
   *
   * `| undefined` is explicit because `exactOptionalPropertyTypes` is on:
   * without it, the perfectly ordinary `className={props.className}` — where
   * the caller's own prop is optional — is a type error. React's own
   * attribute types spell every optional prop this way for the same reason.
   */
  className?: string | undefined;
}

const variantClasses: Record<Variant, string> = {
  primary: "bg-[var(--color-primary)] text-[var(--color-primary-fg)] hover:opacity-90",
  secondary: "bg-[var(--color-muted)] text-[var(--color-fg)] hover:bg-[var(--color-border)]",
  ghost: "bg-transparent hover:bg-[var(--color-muted)] text-[var(--color-fg)]",
  danger: "bg-[var(--color-danger)] text-white hover:opacity-90",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

/**
 * The elements whose `disabled` attribute the browser actually implements.
 *
 * Everything else — an anchor, a `span`, a `Link` — has to be told the same
 * thing in ARIA and then be stopped by hand.
 */
const DISABLEABLE_TAGS = new Set(["button", "input", "fieldset", "select", "textarea"]);

/**
 * How to express "disabled" on whatever `as` resolved to.
 *
 * For a native control the attribute does everything: it is announced, it is
 * removed from the tab order, and it suppresses click and keyboard activation
 * in the browser rather than in our handler.
 *
 * For anything else there is nothing to set, so the state has to be announced
 * with `aria-disabled` and enforced separately. Intercepting `click` is enough
 * to cover the keyboard too — Enter on a focused anchor dispatches a click —
 * and `preventDefault` is what stops the navigation an `href` would otherwise
 * perform. The tab order is deliberately left alone: `tabIndex={-1}` would
 * match `<button disabled>` more closely, but a focusable element announcing
 * `aria-disabled` is what ARIA recommends for exactly this case, and reaching
 * into the caller's `tabIndex` to do it is a worse trade.
 */
function disabledPropsFor(component: ElementType) {
  if (typeof component === "string" && DISABLEABLE_TAGS.has(component)) {
    return { disabled: true } as const;
  }

  return {
    "aria-disabled": true,
    onClick: (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    },
  } as const;
}

/**
 * Button, polymorphic in the element it renders.
 *
 * `as` exists here for one reason above the others: a control that navigates
 * must be an anchor. It is the difference between a link that opens in a new
 * tab on middle-click, is announced as a link, and appears in the browser's
 * status bar, and a `<button onClick={navigate}>` that does none of those and
 * is only found by people who use a mouse the same way the author does.
 *
 * ```tsx
 * <Button as={Link} to={ROUTES.DASHBOARD} variant="primary">Dashboard</Button>
 * <Button as="a" href="https://example.com" target="_blank">Docs</Button>
 * ```
 *
 * `TElement` is left open at `ElementType` rather than constrained the way
 * `Text` constrains its own, because the useful targets here are other
 * *components* — `Link` above, and anything else that takes an `onClick` — and
 * there is no way to enumerate those. The cost of the open parameter is
 * recorded in `docs/polymorphic-components.md`: `as="input"` typechecks and
 * throws at runtime, because React types `children` as optional on every
 * intrinsic element including the void ones.
 */
export function Button<TElement extends ElementType = "button">({
  as,
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...props
}: PolymorphicProps<TElement, ButtonOwnProps>) {
  const Component: ElementType = as ?? "button";
  const isDisabled = disabled ?? loading;

  return (
    <Component
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-md)] font-medium transition-opacity",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
        "aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
      // After `props`, not before: these are the component's decision about a
      // prop it owns, and a caller's stray `onClick` must not reinstate
      // activation on a disabled control.
      {...(isDisabled ? disabledPropsFor(Component) : {})}
    >
      {loading && (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </Component>
  );
}
