import { lazy, Suspense } from "react";
import { createBrowserRouter, type RouteObject } from "react-router";
import { RootLayout } from "@/layouts/RootLayout";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import ErrorPage from "@/pages/ErrorPage";
import {
  HomePageSkeleton,
  DashboardPageSkeleton,
  AboutPageSkeleton,
  LoginPageSkeleton,
} from "@/components/skeletons";
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

const LazyOAuthCallbackPage = lazy(() =>
  import("@/pages/OAuthCallbackPage").then((m) => ({ default: m.OAuthCallbackPage })),
);

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
        element: (
          <Suspense fallback={<HomePageSkeleton />}>
            <LazyHomePage />
          </Suspense>
        ),
      },
      {
        element: <ProtectedRoute />,
        children: [
          {
            path: "dashboard",
            element: (
              <Suspense fallback={<DashboardPageSkeleton />}>
                <LazyDashboardPage />
              </Suspense>
            ),
          },
        ],
      },
      {
        path: "about",
        element: (
          <Suspense fallback={<AboutPageSkeleton />}>
            <LazyAboutPage />
          </Suspense>
        ),
      },
      {
        // Reference demo for the React 19 concurrency pattern. Deliberately
        // unlinked from the nav — it is a lab, not part of the app shell.
        path: "labs/concurrency",
        element: (
          <Suspense fallback={<PageLoader />}>
            <LazyConcurrencyLabPage />
          </Suspense>
        ),
      },
      {
        // Reference demo for the React 19 optimistic-mutation pattern. Also
        // unlinked from the nav — the failing-server mode is not something to
        // stumble into from the app shell.
        path: "labs/optimistic",
        element: (
          <Suspense fallback={<PageLoader />}>
            <LazyOptimisticLabPage />
          </Suspense>
        ),
      },
      {
        // Reference demo for the React 19 `use()` pattern. Unlinked from the
        // nav for the same reason as the others — the failing-server mode is
        // not something to stumble into from the app shell.
        path: "labs/use",
        element: (
          <Suspense fallback={<PageLoader />}>
            <LazyUseApiLabPage />
          </Suspense>
        ),
      },
      {
        // Reference demo for the React 19 Actions API. Unlinked from the nav
        // for the same reason as the others — the failing-server mode is not
        // something to stumble into from the app shell.
        path: "labs/actions",
        element: (
          <Suspense fallback={<PageLoader />}>
            <LazyActionsLabPage />
          </Suspense>
        ),
      },
      {
        // Reference demo for streaming Suspense boundaries. Unlinked from the
        // nav for the same reason as the others — the broken-section mode is
        // not something to stumble into from the app shell.
        path: "labs/streaming",
        element: (
          <Suspense fallback={<PageLoader />}>
            <LazyStreamingLabPage />
          </Suspense>
        ),
      },
      {
        path: "*",
        element: <NotFoundPage />,
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
