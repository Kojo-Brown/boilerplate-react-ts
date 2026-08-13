import {
  createContext,
  use,
  useCallback,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useNavigate, type NavigateOptions, type To } from "react-router";
import { toHref } from "@/router/toHref";

export interface RouteTransition {
  /** True while a navigation has been requested but its route has not committed. */
  isPending: boolean;
  /**
   * Where the held navigation is going, as an href, or `null` when idle.
   *
   * Only meaningful while `isPending` — it is what the pending UI labels itself
   * with, and what a link compares against to decide whether *it* is the one
   * being waited on.
   */
  pendingHref: string | null;
  /** Navigates with the previous route held on screen. See the module docs. */
  navigate: (to: To, options?: NavigateOptions) => void;
}

const RouteTransitionContext = createContext<RouteTransition | null>(null);

/**
 * Owns the transition that every in-app navigation runs inside.
 *
 * One transition for the whole tree rather than one per link, because the
 * pending state has more than one consumer: the progress bar renders it, and
 * each link asks whether it is the destination being waited on. Two links
 * holding separate transitions would each be pending for their own click and
 * blind to the other's.
 *
 * Must sit inside the router — it calls `useNavigate`.
 */
export function RouteTransitionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [isPending, startTransition] = useTransition();
  const [requestedHref, setRequestedHref] = useState<string | null>(null);

  const navigateInTransition = useCallback(
    (to: To, options?: NavigateOptions): void => {
      setRequestedHref(toHref(to));
      startTransition(async () => {
        // The `await` is load-bearing, and its absence is silent.
        //
        // `startTransition(() => navigate(to))` reads like the same thing and
        // is not: `navigate` returns before the router has updated any React
        // state, so the update lands after the synchronous scope has closed
        // and never joins the transition. With these routes — lazy elements,
        // no loaders — it happens to work anyway, because the router does its
        // own `startTransition` internally. Give any route a loader and the
        // sync form keeps navigating while `isPending` stays false forever,
        // so the progress bar simply stops appearing. Pinned by
        // `routeTransition.behaviour.test.tsx`.
        await navigate(to, options);
      });
    },
    [navigate],
  );

  const value = useMemo(
    (): RouteTransition => ({
      isPending,
      // Derived rather than cleared, so there is no window where a settled
      // navigation still reports a destination. A navigation that never
      // suspends resolves within its own commit; `requestedHref` outliving it
      // by a render is harmless as long as nothing reads it while idle.
      pendingHref: isPending ? requestedHref : null,
      navigate: navigateInTransition,
    }),
    [isPending, requestedHref, navigateInTransition],
  );

  return <RouteTransitionContext value={value}>{children}</RouteTransitionContext>;
}

/**
 * Reads the navigation currently being held.
 *
 * Deliberately not falling back to a default: a link that silently navigated
 * outside the transition would look identical and behave differently, which is
 * the exact failure this whole module exists to remove.
 */
export function useRouteTransition(): RouteTransition {
  const value = use(RouteTransitionContext);
  if (!value) {
    throw new Error("useRouteTransition must be used within a <RouteTransitionProvider>");
  }
  return value;
}
