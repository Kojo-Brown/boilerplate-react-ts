import type { ComponentType, ReactNode } from "react";
import { SectionBoundary } from "@/components/suspense/SectionBoundary";
import { copyStatics, wrapDisplayName, type HoistedStatics } from "@/lib/hoc";

export interface WithBoundaryOptions {
  /** Section name, used for the error copy and as a test hook. */
  name: string;
  /** Shown while anything inside the component suspends. */
  fallback: ReactNode;
  /** Invalidate whatever the component reads, before the boundary resets. */
  onRetry?: (() => void) | undefined;
}

/**
 * Wrap a component in its own Suspense + error boundary.
 *
 * ```tsx
 * const GuardedBreakdown = withBoundary(ReportBreakdown, {
 *   name: "breakdown",
 *   fallback: <BreakdownSkeleton />,
 * });
 * ```
 *
 * This is the HOC that has no hook equivalent, and it is worth being precise
 * about why, because "use a hook instead" is the right advice for almost every
 * other HOC in circulation — including `withMediaQuery` next door.
 *
 * A hook runs *inside* the component that calls it, and both of the things a
 * boundary does are things you can only do from outside:
 *
 * - **Catching.** A component that throws has already failed; the error
 *   propagates up to the nearest boundary *above* it. A hook in that component
 *   is part of the render that threw. It cannot catch its own component, and
 *   `try/catch` in a hook cannot either — the throw happens after the hook
 *   returns, in JSX or in a child.
 * - **Suspending.** Same shape. Suspension unwinds to the nearest `<Suspense>`
 *   above the component; a hook cannot install one over itself.
 *
 * So the choice is not HOC-versus-hook. It is HOC versus writing the boundary
 * out at each call site, and the HOC wins only when the pairing is *always*
 * the same — a lazily-loaded section that should never be mounted without its
 * skeleton and its retry. Where the caller decides the layout, `<SectionBoundary>`
 * is the honest spelling and the wrapper only hides where the boundary is,
 * which `docs/suspense-streaming.md` establishes is a load-bearing choice
 * rather than a detail.
 *
 * `React.memo` and `React.lazy` are the same category, which is a good sanity
 * check on the rule: both are HOCs, both survived hooks entirely, and both do
 * something to a component from the outside that nothing inside it can do.
 */
export function withBoundary<TProps extends object, TStatics extends object>(
  Wrapped: ComponentType<TProps> & TStatics,
  options: WithBoundaryOptions,
): ComponentType<TProps> & HoistedStatics<TStatics> {
  function WithBoundary(props: TProps) {
    // Through a plain `ComponentType<TProps>` for the same reason as
    // `withMediaQuery` — see the comment there.
    const Component: ComponentType<TProps> = Wrapped;
    return (
      <SectionBoundary name={options.name} fallback={options.fallback} onRetry={options.onRetry}>
        <Component {...props} />
      </SectionBoundary>
    );
  }

  WithBoundary.displayName = wrapDisplayName(Wrapped, "withBoundary");

  return copyStatics(WithBoundary, Wrapped);
}
