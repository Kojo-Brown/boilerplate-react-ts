import { type ReactNode, lazy, Suspense } from "react";
import { createBrowserRouter, type RouteObject } from "react-router";
import { RootLayout } from "@/layouts/RootLayout";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { PageLoader } from "@/components/ui/PageLoader";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

const LazyHomePage = lazy(() =>
  import("@/pages/HomePage").then((m) => ({ default: m.HomePage })),
);

const LazyDashboardPage = lazy(() =>
  import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);

const LazyAboutPage = lazy(() =>
  import("@/pages/AboutPage").then((m) => ({ default: m.AboutPage })),
);

const LazyLoginPage = lazy(() =>
  import("@/pages/LoginPage").then((m) => ({ default: m.LoginPage })),
);

function SuspensePage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

export const routes: RouteObject[] = [
  {
    path: "/login",
    element: (
      <SuspensePage>
        <LazyLoginPage />
      </SuspensePage>
    ),
  },
  {
    path: "/",
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: (
          <SuspensePage>
            <LazyHomePage />
          </SuspensePage>
        ),
      },
      {
        element: <ProtectedRoute />,
        children: [
          {
            path: "dashboard",
            element: (
              <SuspensePage>
                <LazyDashboardPage />
              </SuspensePage>
            ),
          },
        ],
      },
      {
        path: "about",
        element: (
          <SuspensePage>
            <LazyAboutPage />
          </SuspensePage>
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
