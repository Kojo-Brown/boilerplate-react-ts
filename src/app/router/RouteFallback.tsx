import { useLocation } from "react-router";
import { AboutPageSkeleton } from "@/pages/about/AboutPageSkeleton";
import { DashboardPageSkeleton } from "@/pages/dashboard/DashboardPageSkeleton";
import { HomePageSkeleton } from "@/pages/home/HomePageSkeleton";
import { PageLoader } from "@/shared/ui/PageLoader";
import { ROUTES } from "@/shared/routes/paths";

const PAGE_SKELETONS: Record<string, () => React.ReactElement> = {
  [ROUTES.HOME]: HomePageSkeleton,
  [ROUTES.DASHBOARD]: DashboardPageSkeleton,
  [ROUTES.ABOUT]: AboutPageSkeleton,
};

/**
 * Fallback for the one Suspense boundary that sits above `<Outlet>`.
 *
 * Hoisting the boundary is what makes the previous page survive a navigation
 * (see `docs/route-transitions.md`), but a single boundary would ordinarily
 * mean a single generic spinner, losing the per-route skeletons. Choosing the
 * skeleton by pathname gets both.
 *
 * Reading `useLocation()` here is correct precisely because of *when* this
 * renders. A fallback is only ever shown when the boundary is newly mounted —
 * a cold load or a reload — and then the committed location already is the
 * route being waited on. During an in-app navigation the boundary is not new,
 * React holds the previous page instead, and this component never renders at
 * all; the stale location it would have read is unreachable rather than
 * tolerated.
 */
export function RouteFallback() {
  const { pathname } = useLocation();
  const Skeleton = PAGE_SKELETONS[pathname] ?? PageLoader;
  return <Skeleton />;
}
