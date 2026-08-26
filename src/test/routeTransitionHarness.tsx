import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { RouteTransitionProvider } from "@/features/route-transition/routeTransition";

export interface RouteTransitionHarnessProps {
  children: ReactNode;
  initialEntries?: string[];
}

/**
 * The two contexts every transition-aware link needs.
 *
 * `<RouteTransitionProvider>` throws rather than defaulting when it is absent,
 * so a component that navigates cannot be rendered bare in a test and still
 * behave the way it does in the app. Supplying both here keeps that strictness
 * from turning into boilerplate at every call site.
 */
export function RouteTransitionHarness({
  children,
  initialEntries = ["/"],
}: RouteTransitionHarnessProps) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <RouteTransitionProvider>{children}</RouteTransitionProvider>
    </MemoryRouter>
  );
}
