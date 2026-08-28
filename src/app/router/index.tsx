import { lazy, Suspense } from "react";
import { createBrowserRouter, type RouteObject } from "react-router";
import { RootLayout } from "@/widgets/layout/RootLayout";
import { RouteFallback } from "@/app/router/RouteFallback";
import { NotFoundPage } from "@/pages/not-found/NotFoundPage";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
import ErrorPage from "@/pages/error/ErrorPage";
import { LoginPageSkeleton } from "@/pages/login/LoginPageSkeleton";
import { PageLoader } from "@/shared/ui/PageLoader";

const LazyHomePage = lazy(() =>
  import("@/pages/home/HomePage").then((m) => ({ default: m.HomePage })),
);

const LazyDashboardPage = lazy(() =>
  import("@/pages/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);

const LazyAboutPage = lazy(() =>
  import("@/pages/about/AboutPage").then((m) => ({ default: m.AboutPage })),
);

const LazyLoginPage = lazy(() =>
  import("@/pages/login/LoginPage").then((m) => ({ default: m.LoginPage })),
);

const LazyConcurrencyLabPage = lazy(() =>
  import("@/pages/concurrency-lab/ConcurrencyLabPage").then((m) => ({
    default: m.ConcurrencyLabPage,
  })),
);

const LazyOptimisticLabPage = lazy(() =>
  import("@/pages/optimistic-lab/OptimisticLabPage").then((m) => ({
    default: m.OptimisticLabPage,
  })),
);

const LazyUseApiLabPage = lazy(() =>
  import("@/pages/use-api-lab/UseApiLabPage").then((m) => ({ default: m.UseApiLabPage })),
);

const LazyActionsLabPage = lazy(() =>
  import("@/pages/actions-lab/ActionsLabPage").then((m) => ({ default: m.ActionsLabPage })),
);

const LazyStreamingLabPage = lazy(() =>
  import("@/pages/streaming-lab/StreamingLabPage").then((m) => ({ default: m.StreamingLabPage })),
);

const LazyNavigationLabPage = lazy(() =>
  import("@/pages/navigation-lab/NavigationLabPage").then((m) => ({
    default: m.NavigationLabPage,
  })),
);

const LazySlowRouteLabRoute = lazy(() =>
  import("@/pages/navigation-lab/SlowRouteLabPage").then((m) => ({ default: m.SlowRouteLabRoute })),
);

const LazyPolymorphicLabPage = lazy(() =>
  import("@/pages/polymorphic-lab/PolymorphicLabPage").then((m) => ({
    default: m.PolymorphicLabPage,
  })),
);

const LazyHeadlessLabPage = lazy(() =>
  import("@/pages/headless-lab/HeadlessLabPage").then((m) => ({ default: m.HeadlessLabPage })),
);

const LazyRenderPropsLabPage = lazy(() =>
  import("@/pages/render-props-lab/RenderPropsLabPage").then((m) => ({
    default: m.RenderPropsLabPage,
  })),
);

const LazyDependencyInversionLabPage = lazy(() =>
  import("@/pages/dependency-inversion-lab/DependencyInversionLabPage").then((m) => ({
    default: m.DependencyInversionLabPage,
  })),
);

const LazyCheckoutLabPage = lazy(() =>
  import("@/pages/checkout-lab/CheckoutLabPage").then((m) => ({ default: m.CheckoutLabPage })),
);

const LazyOAuthCallbackPage = lazy(() =>
  import("@/pages/oauth-callback/OAuthCallbackPage").then((m) => ({
    default: m.OAuthCallbackPage,
  })),
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
    element: <RootLayout fallback={<RouteFallback />} />,
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
        // Reference demo for the polymorphic `as` prop. Unlinked from the nav
        // like the others — an element picker over one paragraph is a lab
        // exhibit, not something the app shell needs.
        path: "labs/polymorphic",
        element: <LazyPolymorphicLabPage />,
      },
      {
        // Reference demo for render props and HOCs against the hook that
        // replaced them. Unlinked from the nav like the others — a row of
        // three cards reporting the same boolean is a lab exhibit.
        path: "labs/render-props",
        element: <LazyRenderPropsLabPage />,
      },
      {
        // Reference demo for the XState checkout machine. Unlinked from the
        // nav like the others — a basket that cannot actually be bought is a
        // lab exhibit, not part of the app shell.
        path: "labs/checkout",
        element: <LazyCheckoutLabPage />,
      },
      {
        // Reference demo for the injected API client. Unlinked from the nav
        // like the others — a page whose point is that its data is fake is a
        // lab exhibit, not part of the app shell.
        path: "labs/dependency-inversion",
        element: <LazyDependencyInversionLabPage />,
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
