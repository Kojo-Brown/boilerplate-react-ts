import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/shared/ui/Button";

export interface ErrorFallbackProps {
  error: Error;
  reset: () => void;
}

export function ErrorFallback({ error, reset }: ErrorFallbackProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-4 p-8 py-16 text-center"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-[var(--color-danger)]"
        aria-hidden="true"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="max-w-md text-sm text-[var(--color-muted-fg)]">
        {error.message || "An unexpected error occurred."}
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}

/** Why the boundary cleared its error. */
export type ResetReason = "keys" | "imperative";

interface Props {
  children: ReactNode;
  fallback?: (props: ErrorFallbackProps) => ReactNode;
  /**
   * Values that clear the error when any of them changes.
   *
   * A boundary without these is stateful in a way that outlives the thing that
   * broke. React reconciles by position and type, so a boundary rendered at a
   * shared slot — one per route at the router's `<Outlet>`, one per row in a
   * list — is *the same instance* before and after the content under it
   * changes. Its error state survives that change, so a route that threw keeps
   * showing its fallback after the user has navigated somewhere else entirely,
   * and the destination never renders. Nothing about that looks like a
   * boundary bug from the outside: the user clicked a working link and got the
   * previous page's error.
   *
   * The array is compared element-wise with `Object.is`, never by identity.
   * Callers write `resetKeys={[location.key]}`, which is a new array on every
   * render — an identity comparison would clear the error on every render,
   * re-render the children, catch the same throw and clear it again, and the
   * boundary would either never show a fallback or exceed React's update
   * depth. Length is compared too, so a caller that swaps a key in or out is
   * treated as a change rather than silently matching on the shared prefix.
   */
  resetKeys?: readonly unknown[];
  /**
   * Called once per caught error, from `componentDidCatch`.
   *
   * Deliberately not called from `getDerivedStateFromError`: that runs in the
   * render phase, which React may run more than once for a single error and
   * discard, so reporting from there double-counts.
   */
  onError?: (error: Error, info: ErrorInfo) => void;
  /** Called when the error is cleared, with what cleared it. */
  onReset?: (reason: ResetReason) => void;
}

interface State {
  error: Error | null;
  /** The `resetKeys` this boundary last compared against. */
  resetKeys: readonly unknown[];
}

function keysChanged(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return true;
  return a.some((value, index) => !Object.is(value, b[index]));
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, resetKeys: this.props.resetKeys ?? [] };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  /**
   * Clears the error in the same pass that changed the keys.
   *
   * This is the render phase on purpose. Doing the comparison in
   * `componentDidUpdate` instead — the shape most examples use, because it can
   * call the callback directly — clears the error one commit *later*, so the
   * navigation that was supposed to resolve the error paints the previous
   * route's fallback for a frame before the new route appears. Deriving it
   * means the fallback is never committed at all.
   */
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    const next = props.resetKeys ?? [];
    if (!keysChanged(state.resetKeys, next)) return null;
    // Snapshot the keys whether or not there is an error to clear, so the
    // *next* comparison is against what was last seen rather than against the
    // keys from before an unrelated change.
    return state.error === null ? { resetKeys: next } : { error: null, resetKeys: next };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const { onError } = this.props;
    if (onError !== undefined) {
      onError(error, info);
      return;
    }
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  /**
   * Reports a reset once the boundary is actually showing its children again.
   *
   * The reason is derived from the props rather than recorded when `reset()`
   * runs, and that is not a simplification — the recorded version was wrong.
   * An in-place retry against a *deterministic* error re-throws inside the
   * same update, so no reset is ever committed and a flag set by the click
   * survives, unconsumed, until the next reset — which is typically the
   * key-driven one on the following navigation, and is then reported as
   * "imperative". A consumer resetting per-navigation state on `"keys"`
   * (`RouteErrorBoundary` resets its retry budget there) silently stops doing
   * it after the first failed retry. Comparing the keys says what actually
   * changed, with nothing to leave stale.
   *
   * Note that this fires only when the boundary recovers. A retry that throws
   * again is not a reset, and is not reported as one.
   */
  override componentDidUpdate(prevProps: Props, prevState: State): void {
    if (prevState.error === null || this.state.error !== null) return;
    const reason: ResetReason = keysChanged(prevProps.resetKeys ?? [], this.props.resetKeys ?? [])
      ? "keys"
      : "imperative";
    this.props.onReset?.(reason);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (error !== null) {
      if (fallback !== undefined) {
        return fallback({ error, reset: this.reset });
      }
      return <ErrorFallback error={error} reset={this.reset} />;
    }

    return children;
  }
}
