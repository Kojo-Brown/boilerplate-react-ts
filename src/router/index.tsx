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
        path: "*",
        element: <NotFoundPage />,
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
