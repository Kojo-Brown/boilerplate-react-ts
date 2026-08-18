import { lazy, Suspense } from "react";
import { createBrowserRouter, type RouteObject } from "react-router";
import { RootLayout } from "@/layouts/RootLayout";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import ErrorPage from "@/pages/ErrorPage";
import { LoginPageSkeleton } from "@/components/skeletons";
import { PageLoader } from "@/components/ui/PageLoader";

const LazyHomePage = lazy(() => import("@/pages/HomePage").then((m) => ({ default: m.HomePage })));

const LazyDashboardPage = lazy(() =>
  import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);

const LazyAboutPage = lazy(() =>
  import("@/pages/AboutPage").then((m) => ({ default: m.AboutPage })),
);

const LazyLoginPage = lazy(() =>
  import("@/pages/LoginPage").then((m) => ({ default: m.LoginPage })),
);

const LazyConcurrencyLabPage = lazy(() =>
  import("@/pages/ConcurrencyLabPage").then((m) => ({ default: m.ConcurrencyLabPage })),
);

const LazyOptimisticLabPage = lazy(() =>
  import("@/pages/OptimisticLabPage").then((m) => ({ default: m.OptimisticLabPage })),
);

const LazyUseApiLabPage = lazy(() =>
  import("@/pages/UseApiLabPage").then((m) => ({ default: m.UseApiLabPage })),
);

const LazyActionsLabPage = lazy(() =>
  import("@/pages/ActionsLabPage").then((m) => ({ default: m.ActionsLabPage })),
);

const LazyStreamingLabPage = lazy(() =>
  import("@/pages/StreamingLabPage").then((m) => ({ default: m.StreamingLabPage })),
);

const LazyNavigationLabPage = lazy(() =>
  import("@/pages/NavigationLabPage").then((m) => ({ default: m.NavigationLabPage })),
);

const LazySlowRouteLabRoute = lazy(() =>
  import("@/pages/SlowRouteLabPage").then((m) => ({ default: m.SlowRouteLabRoute })),
);

const LazyHeadlessLabPage = lazy(() =>
  import("@/pages/HeadlessLabPage").then((m) => ({ default: m.HeadlessLabPage })),
);

const LazyOAuthCallbackPage = lazy(() =>
  import("@/pages/OAuthCallbackPage").then((m) => ({ default: m.OAuthCallbackPage })),
);

/*
 * Route elements under `/` carry no `<Suspense>` of their own.
 *
 * `RootLayout` holds one boundary above `<Outlet>` for all of them, which is
 * what lets a navigation keep the previous page on screen instead of swapping
 * it for a skeleton — see the comment there and `docs/route-transitions.md`.
 * Re-adding a boundary to a route element below would restore the flash for
 * that route only, silently.
 *
 * `/login` and `/auth/callback` are outside the layout and so keep theirs:
 * with no shared parent boundary there is no previous page to hold, and their
 * skeleton is the only thing that can be shown.
 */
export const routes: RouteObject[] = [
  {
    path: "/login",
    element: (
      <Suspense fallback={<LoginPageSkeleton />}>
        <LazyLoginPage />
      </Suspense>
    ),
  },
  {
    path: "/auth/callback",
    element: (
      <Suspense fallback={<PageLoader />}>
        <LazyOAuthCallbackPage />
      </Suspense>
    ),
  },
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <ErrorPage />,
    children: [
      {
        index: true,
        element: <LazyHomePage />,
      },
      {
        element: <ProtectedRoute />,
        children: [
          {
            path: "dashboard",
            element: <LazyDashboardPage />,
          },
        ],
      },
      {
        path: "about",
        element: <LazyAboutPage />,
      },
      {
        // Reference demo for the React 19 concurrency pattern. Deliberately
        // unlinked from the nav — it is a lab, not part of the app shell.
        path: "labs/concurrency",
        element: <LazyConcurrencyLabPage />,
      },
      {
        // Reference demo for the React 19 optimistic-mutation pattern. Also
        // unlinked from the nav — the failing-server mode is not something to
        // stumble into from the app shell.
        path: "labs/optimistic",
        element: <LazyOptimisticLabPage />,
      },
      {
        // Reference demo for the React 19 `use()` pattern. Unlinked from the
        // nav for the same reason as the others — the failing-server mode is
        // not something to stumble into from the app shell.
        path: "labs/use",
        element: <LazyUseApiLabPage />,
      },
      {
        // Reference demo for the React 19 Actions API. Unlinked from the nav
        // for the same reason as the others — the failing-server mode is not
        // something to stumble into from the app shell.
        path: "labs/actions",
        element: <LazyActionsLabPage />,
      },
      {
        // Reference demo for streaming Suspense boundaries. Unlinked from the
        // nav for the same reason as the others — the broken-section mode is
        // not something to stumble into from the app shell.
        path: "labs/streaming",
        element: <LazyStreamingLabPage />,
      },
      {
        // Reference demo for held route transitions. Unlinked from the nav for
        // the same reason as the others — its slow-route mode is deliberately
        // unpleasant to navigate.
        path: "labs/navigation",
        element: <LazyNavigationLabPage />,
      },
      {
        // Reference demo for the headless component pattern. Unlinked from the
        // nav like the others — three renderings of one list is a lab exhibit,
        // not something the app shell needs.
        path: "labs/headless",
        element: <LazyHeadlessLabPage />,
      },
      {
        // The lab's destination. Its element decides where its own boundary
        // goes, which is the one thing a route config cannot express twice.
        path: "labs/navigation/slow",
        element: <LazySlowRouteLabRoute />,
      },
      {
        path: "*",
        element: <NotFoundPage />,
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
