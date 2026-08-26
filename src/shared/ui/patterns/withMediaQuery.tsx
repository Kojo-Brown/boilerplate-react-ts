import type { ComponentType } from "react";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import { copyStatics, wrapDisplayName, type HoistedStatics } from "@/shared/lib/hoc";
import type { DistributiveOmit } from "@/shared/lib/polymorphic";

/** The prop this HOC supplies. The wrapped component must declare it. */
export interface MediaQueryInjectedProps {
  matches: boolean;
}

/** What is left for the caller to pass: everything except what is injected. */
export type WithMediaQueryProps<TProps> = DistributiveOmit<TProps, keyof MediaQueryInjectedProps>;

/**
 * The higher-order-component delivery of {@link useMediaQuery}.
 *
 * ```tsx
 * const WideBanner = withMediaQuery(Banner, "(min-width: 48rem)");
 * ```
 *
 * A worked example for `docs/render-props-and-hocs.md`, and — like
 * `<MediaQuery>` — an adapter rather than an implementation. Written today
 * this would be `useMediaQuery()` in `Banner` itself. Two properties of the
 * type are the reason it is still worth having one of these on file, because
 * both are things a hand-rolled HOC usually gets wrong.
 *
 * **The injected prop is subtracted from the caller's props.** `WideBanner`
 * does not accept `matches`; passing one is a compile error rather than a
 * value that is silently discarded by the spread below. Getting this wrong is
 * the classic HOC defect — the caller passes `matches`, the HOC overwrites it,
 * and nothing anywhere reports a problem.
 *
 * **The subtraction distributes.** `Omit<A | B, K>` is built from the keys `A`
 * and `B` share, so a union prop type would be collapsed to its common keys
 * and every prop unique to a branch would vanish — the same trap recorded in
 * `polymorphic.ts`, reached here by a wrapped component whose props are a
 * discriminated union.
 *
 * `ref` needs no special handling. In React 19 it is an ordinary prop, so it
 * arrives in `props` and the spread carries it to the wrapped component like
 * anything else. Under React 18 this function would have had to be a
 * `forwardRef` call with the ref threaded through by hand, and a HOC that
 * forgot to do so produced a `ref` that silently pointed at nothing.
 *
 * ## Why the statics ride in an `Omit`
 *
 * `TStatics` exists so a static hung off the wrapped component survives in the
 * *type* as well as at runtime. The obvious spelling of that return type —
 * `ComponentType<WithMediaQueryProps<TProps>> & TStatics` — compiles and then
 * breaks every caller, for a reason worth recording because the error it
 * produces points somewhere else entirely.
 *
 * `TStatics` is inferred from the whole argument, and a component's type
 * includes its **call signature**. Intersecting that back in gives JSX two
 * signatures to choose from — the wrapper's, and the inner component's — and
 * it resolves to the inner one, so `<WideBanner />` is asked for `matches`
 * again and the injected prop reappears in the caller's props with an error on
 * the tag. `Omit` is the fix precisely because it is lossy: an omitted object
 * type has no call signature, so `HoistedStatics<TStatics>` carries the
 * statics and nothing else. Both halves are asserted in the
 * `@ts-expect-error` block at the bottom of `withMediaQuery.test.tsx`.
 */
export function withMediaQuery<TProps extends MediaQueryInjectedProps, TStatics extends object>(
  Wrapped: ComponentType<TProps> & TStatics,
  query: string,
): ComponentType<WithMediaQueryProps<TProps>> & HoistedStatics<TStatics> {
  function WithMediaQuery(props: WithMediaQueryProps<TProps>) {
    const matches = useMediaQuery(query);
    /*
     * The assertion is unavoidable and is a limitation of TypeScript rather
     * than a shortcut: for an unresolved generic `TProps`, the compiler cannot
     * prove that `Omit<TProps, "matches"> & { matches: boolean }` reconstructs
     * `TProps` (microsoft/TypeScript#28884). Every typed HOC in the wild has
     * this line. What makes it safe here is the direction of the subtraction —
     * the only key removed is the only key added back, and both are named by
     * `MediaQueryInjectedProps`, so the two cannot drift apart.
     */
    const wrappedProps = { ...props, matches } as unknown as TProps;
    /*
     * Rendered through a plain `ComponentType<TProps>` rather than through
     * `Wrapped` directly. JSX cannot resolve an element type that is an
     * intersection with an unresolved generic — it reports every prop as
     * unassignable to `LibraryManagedAttributes<… & TStatics, TProps>`, an
     * error that names the statics and has nothing to do with them. Dropping
     * the intersection for the render is safe: statics are values, and this is
     * the one place that only needs the call signature.
     */
    const Component: ComponentType<TProps> = Wrapped;
    return <Component {...wrappedProps} />;
  }

  WithMediaQuery.displayName = wrapDisplayName(Wrapped, "withMediaQuery");

  return copyStatics(WithMediaQuery, Wrapped);
}
