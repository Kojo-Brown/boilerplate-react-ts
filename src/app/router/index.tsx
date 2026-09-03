import { lazy, Suspense } from "react";
import { createBrowserRouter, type RouteObject } from "react-router";
import { RootLayout } from "@/widgets/layout/RootLayout";
import { RouteFallback } from "@/app/router/RouteFallback";
import { NotFoundPage } from "@/pages/not-found/NotFoundPage";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
import ErrorPage from "@/pages/error/ErrorPage";
import { LoginPageSkeleton } from "@/pages/login/LoginPageSkeleton";
import { PageLoader } from "@/shared/ui/PageLoader";
import { routeChunks, SLOW_ROUTE_PATH } from "@/app/router/routeChunks";
import { ROUTES } from "@/shared/routes/paths";

/*
 * Every one of these is built from `routeChunks`, not from an `import()`
 * written here. `React.lazy` has no `preload`, so the prefetcher has to issue
 * its own dynamic import — sharing one thunk is what makes it provably the
 * same chunk. See `routeChunks.ts`.
 */
const LazyHomePage = lazy(() => routeChunks[ROUTES.HOME]().then((m) => ({ default: m.HomePage })));

const LazyDashboardPage = lazy(() =>
  routeChunks[ROUTES.DASHBOARD]().then((m) => ({ default: m.DashboardPage })),
);

const LazyAboutPage = lazy(() =>
  routeChunks[ROUTES.ABOUT]().then((m) => ({ default: m.AboutPage })),
);

const LazyLoginPage = lazy(() =>
  routeChunks[ROUTES.LOGIN]().then((m) => ({ default: m.LoginPage })),
);

const LazyConcurrencyLabPage = lazy(() =>
  routeChunks[ROUTES.CONCURRENCY_LAB]().then((m) => ({ default: m.ConcurrencyLabPage })),
);

const LazyOptimisticLabPage = lazy(() =>
  routeChunks[ROUTES.OPTIMISTIC_LAB]().then((m) => ({ default: m.OptimisticLabPage })),
);

const LazyUseApiLabPage = lazy(() =>
  routeChunks[ROUTES.USE_API_LAB]().then((m) => ({ default: m.UseApiLabPage })),
);

const LazyActionsLabPage = lazy(() =>
  routeChunks[ROUTES.ACTIONS_LAB]().then((m) => ({ default: m.ActionsLabPage })),
);

const LazyStreamingLabPage = lazy(() =>
  routeChunks[ROUTES.STREAMING_LAB]().then((m) => ({ default: m.StreamingLabPage })),
);

const LazyNavigationLabPage = lazy(() =>
  routeChunks[ROUTES.NAVIGATION_LAB]().then((m) => ({ default: m.NavigationLabPage })),
);

const LazySlowRouteLabRoute = lazy(() =>
  routeChunks[SLOW_ROUTE_PATH]().then((m) => ({ default: m.SlowRouteLabRoute })),
);

const LazyPolymorphicLabPage = lazy(() =>
  routeChunks[ROUTES.POLYMORPHIC_LAB]().then((m) => ({ default: m.PolymorphicLabPage })),
);

const LazyHeadlessLabPage = lazy(() =>
  routeChunks[ROUTES.HEADLESS_LAB]().then((m) => ({ default: m.HeadlessLabPage })),
);

const LazyRenderPropsLabPage = lazy(() =>
  routeChunks[ROUTES.RENDER_PROPS_LAB]().then((m) => ({ default: m.RenderPropsLabPage })),
);

const LazyDependencyInversionLabPage = lazy(() =>
  routeChunks[ROUTES.DEPENDENCY_INVERSION_LAB]().then((m) => ({
    default: m.DependencyInversionLabPage,
  })),
);

const LazyCheckoutLabPage = lazy(() =>
  routeChunks[ROUTES.CHECKOUT_LAB]().then((m) => ({ default: m.CheckoutLabPage })),
);

const LazyWorkerLabPage = lazy(() =>
  routeChunks[ROUTES.WORKER_LAB]().then((m) => ({ default: m.WorkerLabPage })),
);

const LazyInfiniteScrollLabPage = lazy(() =>
  routeChunks[ROUTES.INFINITE_SCROLL_LAB]().then((m) => ({ default: m.InfiniteScrollLabPage })),
);

const LazyPrefetchLabPage = lazy(() =>
  routeChunks[ROUTES.PREFETCH_LAB]().then((m) => ({ default: m.PrefetchLabPage })),
);

const LazyOAuthCallbackPage = lazy(() =>
  routeChunks[ROUTES.OAUTH_CALLBACK]().then((m) => ({ default: m.OAuthCallbackPage })),
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
    element: <RootLayout fallback={<RouteFallback />} prefetchRegistry={routeChunks} />,
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
        // Reference demo for parsing off the main thread. Unlinked from the
        // nav like the others — its main-thread arm deliberately freezes the
        // page for seconds, which is not something to stumble into.
        path: "labs/workers",
        element: <LazyWorkerLabPage />,
      },
      {
        // Reference demo for windowed infinite scroll. Unlinked from the nav
        // like the others — it loads 5,000 rows from the mock feed, which is a
        // demonstration rather than a page the app has a use for.
        path: "labs/infinite-scroll",
        element: <LazyInfiniteScrollLabPage />,
      },
      {
        // Reference demo for idle-budgeted route prefetching. Unlinked from
        // the nav like the others — most of what it shows is a queue that is
        // deliberately empty until you interact with it.
        path: "labs/prefetch",
        element: <LazyPrefetchLabPage />,
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
