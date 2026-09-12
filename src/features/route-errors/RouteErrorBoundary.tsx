import { useCallback, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router";
import { Button } from "@/shared/ui/Button";
import { cn } from "@/shared/lib/cn";
import { ErrorBoundary, type ResetReason } from "@/shared/ui/ErrorBoundary";
import { useErrorReporter } from "@/shared/observability/errorReporterContext";
import {
  classifyRouteError,
  tryClaimReload,
  type RouteErrorKind,
} from "@/features/route-errors/routeErrorKind";

export interface RouteErrorBoundaryProps {
  /**
   * The route this boundary guards. Used as the `route` tag on every event it
   * reports, which is what makes "which page is broken" a dashboard facet
   * rather than something to infer from a component stack.
   */
  route: string;
  /**
   * How many in-place retries to offer before escalating to a reload.
   *
   * Two, not unlimited. A retry helps exactly when the error was transient —
   * a rejected request, a race that lost. When it was deterministic, every
   * additional press re-renders the same throw, and an error screen whose
   * primary action has visibly done nothing twice is worse than one that
   * admits it and offers something else.
   */
  maxRetries?: number;
  children: ReactNode;
}

/** Everything the fallback needs, derived once per caught error. */
interface CaughtState {
  kind: RouteErrorKind;
  message: string;
  /** `null` when the reporter dropped the event (deduped, or filtered). */
  eventId: string | null;
}

/**
 * One route's error boundary: reports, retries, and gets out of the way on
 * navigation.
 *
 * **Reset keys are what make it per-route rather than per-position.** This
 * boundary sits at the router's `<Outlet>` slot, and every route renders the
 * same component type there, so React reconciles all of them onto one
 * instance. Without a key tied to the location, a route that threw keeps
 * showing its fallback after the user navigates away — the link works, the URL
 * changes, and the destination page never renders, because the boundary above
 * it is still holding the previous route's error. `location.key` rather than
 * `pathname`: it changes on same-path navigations too, so re-entering a broken
 * route or changing only its query string (the query being, often, what broke
 * it) clears the error as the user expects.
 *
 * **React Router's own `errorElement` gets the other half right and this half
 * wrong, which is why this is a React boundary.** A route error held by the
 * router *is* cleared by navigating away — but the router exposes no way to
 * clear it in place, so a "Try again" there has to be a navigation to the same
 * path. `useRevalidator`, the API that looks like the answer, revalidates
 * loaders and leaves the error exactly where it is on routes that have none.
 * Recovering in place, without discarding the rest of the app's state, needs a
 * boundary that owns its error — and then needs reset keys to buy back the
 * behaviour the router had for free. `<ErrorPage>` stays wired as the router's
 * `errorElement` for what this cannot catch: an error thrown by the layout
 * itself, above every route.
 */
export function RouteErrorBoundary({ route, maxRetries = 2, children }: RouteErrorBoundaryProps) {
  const location = useLocation();
  const reporter = useErrorReporter();
  const [caught, setCaught] = useState<CaughtState | null>(null);
  const [attempt, setAttempt] = useState(0);
  /**
   * Read inside `handleError`, which React calls during a commit. Reading
   * `attempt` from state there would close over the value from the render that
   * threw, and the whole point of the tag is to say *which* attempt failed.
   */
  const attemptRef = useRef(0);

  const handleError = useCallback(
    (error: Error, info: ErrorInfo) => {
      const kind = classifyRouteError(error);
      const eventId = reporter.captureException(error, {
        level: "error",
        mechanism: { type: "route-boundary", handled: true },
        tags: {
          route,
          "error.kind": kind,
          // A string because tags are a flat string map, the shape every
          // backend indexes them as.
          "retry.attempt": String(attemptRef.current),
        },
        contexts: { route: { path: location.pathname, key: location.key } },
        ...(info.componentStack !== null && info.componentStack !== undefined
          ? { componentStack: info.componentStack }
          : {}),
      });
      setCaught({ kind, message: error.message, eventId });
    },
    [reporter, route, location.pathname, location.key],
  );

  const handleReset = useCallback((reason: ResetReason) => {
    setCaught(null);
    // A navigation is a clean slate; an in-place retry is not, and its count
    // is what the escalation below is reading.
    if (reason === "keys") {
      attemptRef.current = 0;
      setAttempt(0);
    }
  }, []);

  const retry = useCallback((reset: () => void) => {
    attemptRef.current += 1;
    setAttempt(attemptRef.current);
    reset();
  }, []);

  return (
    <ErrorBoundary
      resetKeys={[location.key]}
      onError={handleError}
      onReset={handleReset}
      fallback={({ error, reset }) => (
        <RouteErrorFallback
          route={route}
          message={caught?.message ?? error.message}
          kind={caught?.kind ?? classifyRouteError(error)}
          eventId={caught?.eventId ?? null}
          attempt={attempt}
          maxRetries={maxRetries}
          onRetry={() => {
            retry(reset);
          }}
        />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

export interface RouteErrorFallbackProps {
  route: string;
  message: string;
  kind: RouteErrorKind;
  eventId: string | null;
  attempt: number;
  maxRetries: number;
  onRetry: () => void;
  /** Injected so the test suite can assert a reload was requested. */
  reload?: () => void;
}

/**
 * The screen a broken route shows.
 *
 * Exported and free of router context so it can be rendered and asserted on
 * directly — the three states below are the substance of the feature, and
 * reaching them through a real throw each time tests React's unwinding rather
 * than this component's decision.
 */
export function RouteErrorFallback({
  route,
  message,
  kind,
  eventId,
  attempt,
  maxRetries,
  onRetry,
  reload = () => {
    window.location.reload();
  },
}: RouteErrorFallbackProps) {
  const [reloadBlocked, setReloadBlocked] = useState(false);
  const retriesExhausted = attempt >= maxRetries;
  // A stale chunk is never offered a retry: resetting the boundary re-reads
  // the rejected promise `React.lazy` memoised and rethrows it unchanged.
  const canRetry = kind !== "chunk-load" && !retriesExhausted;

  const handleReload = (): void => {
    if (!tryClaimReload()) {
      setReloadBlocked(true);
      return;
    }
    reload();
  };

  return (
    <div
      role="alert"
      data-testid="route-error"
      data-route={route}
      data-kind={kind}
      className={cn(
        "m-6 flex flex-col items-start gap-3 rounded-[var(--radius-lg)] p-6",
        "border border-[var(--color-danger)] text-[var(--color-fg)]",
      )}
    >
      <h2 className="text-lg font-semibold">
        {kind === "chunk-load" ? "This page needs a refresh" : "This page didn’t load"}
      </h2>

      <p className="max-w-prose text-sm text-[var(--color-muted-fg)]">
        {kind === "chunk-load"
          ? "The app was updated while this tab was open, so part of it is no longer available. Reloading fetches the new version."
          : message || "An unexpected error occurred."}
      </p>

      {kind !== "chunk-load" && retriesExhausted ? (
        <p className="max-w-prose text-sm text-[var(--color-muted-fg)]">
          Retrying didn’t help, so this is unlikely to be temporary. Reloading the page starts over
          from a clean state.
        </p>
      ) : null}

      {reloadBlocked ? (
        <p
          className="max-w-prose text-sm text-[var(--color-muted-fg)]"
          data-testid="reload-blocked"
        >
          The page was already reloaded and the problem came back. It needs attention from someone
          on the team rather than another reload.
        </p>
      ) : null}

      <div className="mt-1 flex flex-wrap gap-3">
        {canRetry ? (
          <Button size="sm" data-testid="route-error-retry" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
        <Button
          size="sm"
          variant={canRetry ? "secondary" : "primary"}
          data-testid="route-error-reload"
          onClick={handleReload}
        >
          Reload page
        </Button>
      </div>

      {eventId !== null ? (
        <p className="text-xs text-[var(--color-muted-fg)]">
          Reference: <code data-testid="route-error-event-id">{eventId.slice(0, 8)}</code>
        </p>
      ) : null}
    </div>
  );
}
