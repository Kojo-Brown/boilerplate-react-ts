import { lazy, Suspense } from "react";
import { createBrowserRouter, type RouteObject } from "react-router";
import { RootLayout } from "@/widgets/layout/RootLayout";
import { RouteFallback } from "@/app/router/RouteFallback";
import { NotFoundPage } from "@/pages/not-found/NotFoundPage";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
import { RouteErrorBoundary } from "@/features/route-errors/RouteErrorBoundary";
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

const LazyQueryCacheLabPage = lazy(() =>
  routeChunks[ROUTES.QUERY_CACHE_LAB]().then((m) => ({ default: m.QueryCacheLabPage })),
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

const LazyKeyboardLabPage = lazy(() =>
  routeChunks[ROUTES.KEYBOARD_LAB]().then((m) => ({ default: m.KeyboardLabPage })),
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

const LazyImageLabPage = lazy(() =>
  routeChunks[ROUTES.IMAGE_LAB]().then((m) => ({ default: m.ImageLabPage })),
);

const LazyErrorLabPage = lazy(() =>
  routeChunks[ROUTES.ERROR_LAB]().then((m) => ({ default: m.ErrorLabPage })),
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
 *
 * Every route element *does* carry its own `<RouteErrorBoundary>`, and the
 * asymmetry with Suspense is the point. Hoisting the Suspense boundary buys
 * shared revealed content, which is what a held transition needs. Hoisting the
 * error boundary would buy shared *blast radius*: one route's throw would
 * replace every route, and the boundary would have nothing to name in the
 * report but the layout. Errors want the opposite of what suspensions want, so
 * they are placed the opposite way.
 *
 * The `route` tag is the path rather than the component, because it is what a
 * dashboard facets on and what a bug report quotes. `<ErrorPage>` stays as the
 * router's `errorElement` for what a per-route boundary cannot see: a throw in
 * the layout itself, above all of them.
 *
 * Every leaf carries a `handle: { title }`, which is what `<RouteAnnouncer>`
 * reads through `useMatches` to say where a navigation landed and what
 * `document.title` becomes. It lives here rather than in a path-keyed map for
 * two reasons: a map is a second list of every route, correct only on the day
 * it is written; and `/no-such-page` has no entry in any such map but does
 * match the `*` route, so a handle is the only form of the answer that can say
 * "Page not found" instead of something inferred from a URL the user mistyped.
 * Layout routes deliberately carry none — `RootLayout` has no name that would
 * be true of the twenty-odd pages it hosts. `router.test.tsx` fails on a leaf
 * that forgets one.
 */
export const routes: RouteObject[] = [
  {
    path: "/login",
    handle: { title: "Sign in" },
    element: (
      // Outside the Suspense boundary here, unlike the routes under `/` whose
      // boundary the layout owns. Either nesting catches a rejected
      // `React.lazy`, but this order also catches a throw from the fallback
      // itself — and `LoginPageSkeleton` is the only fallback in the app that
      // is a real component rather than a spinner.
      <RouteErrorBoundary route={ROUTES.LOGIN}>
        <Suspense fallback={<LoginPageSkeleton />}>
          <LazyLoginPage />
        </Suspense>
      </RouteErrorBoundary>
    ),
  },
  {
    path: "/auth/callback",
    handle: { title: "Signing in" },
    element: (
      <RouteErrorBoundary route={ROUTES.OAUTH_CALLBACK}>
        <Suspense fallback={<PageLoader />}>
          <LazyOAuthCallbackPage />
        </Suspense>
      </RouteErrorBoundary>
    ),
  },
  {
    path: "/",
    element: <RootLayout fallback={<RouteFallback />} prefetchRegistry={routeChunks} />,
    errorElement: <ErrorPage />,
    children: [
      {
        index: true,
        handle: { title: "Home" },
        element: (
          <RouteErrorBoundary route={ROUTES.HOME}>
            <LazyHomePage />
          </RouteErrorBoundary>
        ),
      },
      {
        element: <ProtectedRoute />,
        children: [
          {
            path: "dashboard",
            handle: { title: "Dashboard" },
            element: (
              <RouteErrorBoundary route={ROUTES.DASHBOARD}>
                <LazyDashboardPage />
              </RouteErrorBoundary>
            ),
          },
        ],
      },
      {
        path: "about",
        handle: { title: "About" },
        element: (
          <RouteErrorBoundary route={ROUTES.ABOUT}>
            <LazyAboutPage />
          </RouteErrorBoundary>
        ),
      },
      {
        // Reference demo for the React 19 concurrency pattern. Deliberately
        // unlinked from the nav — it is a lab, not part of the app shell.
        path: "labs/concurrency",
        handle: { title: "Concurrency lab" },
        element: (
          <RouteErrorBoundary route={ROUTES.CONCURRENCY_LAB}>
            <LazyConcurrencyLabPage />
          </RouteErrorBoundary>
        ),
      },
      {
        // Reference demo for the React 19 optimistic-mutation pattern. Also
        // unlinked from the nav — the failing-server mode is not something to
        // stumble into from the app shell.
        path: "labs/optimistic",
        handle: { title: "Optimistic lab" },
        element: (
          <RouteErrorBoundary route={ROUTES.OPTIMISTIC_LAB}>
            <LazyOptimisticLabPage />
          </RouteErrorBoundary>
        ),
      },
      {
        // Reference demo for optimistic writes into the TanStack Query cache.
        // Unlinked from the nav for the same reason as its neighbours — the
        // rejecting-server modes are not something to stumble into.
        path: "labs/query-cache",
        handle: { title: "Query cache lab" },
        element: (
          <RouteErrorBoundary route={ROUTES.QUERY_CACHE_LAB}>
            <LazyQueryCacheLabPage />
          </RouteErrorBoundary>
        ),
      },
      {
        // Reference demo for the React 19 `use()` pattern. Unlinked from the
        // nav for the same reason as the others — the failing-server mode is
        // not something to stumble into from the app shell.
        path: "labs/use",
        handle: { title: "use() lab" },
        element: (
          <RouteErrorBoundary route={ROUTES.USE_API_LAB}>
            <LazyUseApiLabPage />
          </RouteErrorBoundary>
        ),
      },
      {
        // Reference demo for the React 19 Actions API. Unlinked from the nav
        // for the same reason as the others — the failing-server mode is not
        // something to stumble into from the app shell.
        path: "labs/actions",
        handle: { title: "Actions lab" },
        element: (
          <RouteErrorBoundary route={ROUTES.ACTIONS_LAB}>
            <LazyActionsLabPage />
          </RouteErrorBoundary>
        ),
      },
      {
        // Reference demo for streaming Suspense boundaries. Unlinked from the
        // nav for the same reason as the others — the broken-section mode is
        // not something to stumble into from the app shell.
        path: "labs/streaming",
        handle: { title: "Streaming Suspense lab" },
        element: (
          <RouteErrorBoundary route={ROUTES.STREAMING_LAB}>
            <LazyStreamingLabPage />
          </RouteErrorBoundary>
        ),
      },
      {
        // Reference demo for held route transitions. Unlinked from the nav for
        // the same reason as the others — its slow-route mode is deliberately
        // unpleasant to navigate.
        path: "labs/navigation",
        handle: { title: "Route transition lab" },
        element: (
          <RouteErrorBoundary route={ROUTES.NAVIGATION_LAB}>
            <LazyNavigationLabPage />
          </RouteErrorBoundary>
        ),
      },
      {
        // Reference demo for the headless component pattern. Unlinked from the
        // nav like the others — three renderings of one list is a lab exhibit,
        // not something the app shell needs.
        path: "labs/headless",
        handle: { title: "Headless lab" },
        element: (
          <RouteErrorBoundary route={ROUTES.HEADLESS_LAB}>
            <LazyHeadlessLabPage />
          </RouteErrorBoundary>
        ),
      },
      {
        // Reference demo for the four APG keyboard patterns. Unlinked from the
        // nav like the others, and the one lab whose exhibit is a *comparison*
        // — four controls that look alike and answer to different keys.
        path: "labs/keyboard",
        handle: { title: "Keyboard lab" },
        element: (
          <RouteErrorBoundary route={ROUTES.KEYBOARD_LAB}>
            <LazyKeyboardLabPage />
          </RouteErrorBoundary>
        ),
      },
      {
        // Reference demo for the polymorphic `as` prop. Unlinked from the nav
        // like the others — an element picker over one paragraph is a lab
        // exhibit, not something the app shell needs.
        path: "labs/polymorphic",
        handle: { title: "Polymorphic lab" },
        element: (
          <RouteErrorBoundary route={ROUTES.POLYMORPHIC_LAB}>
            <LazyPolymorphicLabPage />
          </RouteErrorBoundary>
        ),
      },
      {
        // Reference demo for render props and HOCs against the hook that
        // replaced them. Unlinked from the nav like the others — a row of
        // three cards reporting the same boolean is a lab exhibit.
        path: "labs/render-props",
        handle: { title: "Render props lab" },
        element: (
          <RouteErrorBoundary route={ROUTES.RENDER_PROPS_LAB}>
            <LazyRenderPropsLabPage />
          </RouteErrorBoundary>
        ),
      },
      {
        // Reference demo for the XState checkout machine. Unlinked from the
        // nav like the others — a basket that cannot actually be bought is a
        // lab exhibit, not part of the app shell.
        path: "labs/checkout",
        handle: { title: "Checkout lab" },
        element: (
          <RouteErrorBoundary route={ROUTES.CHECKOUT_LAB}>
            <LazyCheckoutLabPage />
          </RouteErrorBoundary>
        ),
      },
      {
        // Reference demo for the injected API client. Unlinked from the nav
        // like the others — a page whose point is that its data is fake is a
        // lab exhibit, not part of the app shell.
        path: "labs/dependency-inversion",
        handle: { title: "Dependency inversion lab" },
        element: (
          <RouteErrorBoundary route={ROUTES.DEPENDENCY_INVERSION_LAB}>
            <LazyDependencyInversionLabPage />
          </RouteErrorBoundary>
        ),
      },
      {
        // Reference demo for parsing off the main thread. Unlinked from the
        // nav like the others — its main-thread arm deliberately freezes the
        // page for seconds, which is not something to stumble into.
        path: "labs/workers",
        handle: { title: "Web worker lab" },
        element: (
          <RouteErrorBoundary route={ROUTES.WORKER_LAB}>
            <LazyWorkerLabPage />
          </RouteErrorBoundary>
        ),
      },
      {
        // Reference demo for windowed infinite scroll. Unlinked from the nav
        // like the others — it loads 5,000 rows from the mock feed, which is a
        // demonstration rather than a page the app has a use for.
        path: "labs/infinite-scroll",
        handle: { title: "Windowed infinite scroll lab" },
        element: (
          <RouteErrorBoundary route={ROUTES.INFINITE_SCROLL_LAB}>
            <LazyInfiniteScrollLabPage />
          </RouteErrorBoundary>
        ),
      },
      {
        // Reference demo for idle-budgeted route prefetching. Unlinked from
        // the nav like the others — most of what it shows is a queue that is
        // deliberately empty until you interact with it.
        path: "labs/prefetch",
        handle: { title: "Prefetch lab" },
        element: (
          <RouteErrorBoundary route={ROUTES.PREFETCH_LAB}>
            <LazyPrefetchLabPage />
          </RouteErrorBoundary>
        ),
      },
      {
        // Reference demo for the image pipeline. Unlinked from the nav like
        // the others — its point is a fixture that answers slowly and an arm
        // that deliberately reflows the page.
        path: "labs/images",
        handle: { title: "Image lab" },
        element: (
          <RouteErrorBoundary route={ROUTES.IMAGE_LAB}>
            <LazyImageLabPage />
          </RouteErrorBoundary>
        ),
      },
      {
        // Reference demo for per-route error boundaries. Unlinked from the nav
        // like the others — every arm of it is a page that deliberately
        // throws, which is not something to stumble into from the app shell.
        path: "labs/errors",
        handle: { title: "Error lab" },
        element: (
          <RouteErrorBoundary route={ROUTES.ERROR_LAB}>
            <LazyErrorLabPage />
          </RouteErrorBoundary>
        ),
      },
      {
        // The lab's destination. Its element decides where its own boundary
        // goes, which is the one thing a route config cannot express twice.
        path: "labs/navigation/slow",
        handle: { title: "Slow route" },
        element: (
          <RouteErrorBoundary route={SLOW_ROUTE_PATH}>
            <LazySlowRouteLabRoute />
          </RouteErrorBoundary>
        ),
      },
      {
        path: "*",
        handle: { title: "Page not found" },
        element: (
          <RouteErrorBoundary route="*">
            <NotFoundPage />
          </RouteErrorBoundary>
        ),
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
