import { type ReactNode, lazy, Suspense } from "react";
import { createBrowserRouter, type RouteObject } from "react-router";
import { RootLayout } from "@/layouts/RootLayout";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { PageLoader } from "@/components/ui/PageLoader";

const LazyHomePage = lazy(() =>
  import("@/pages/HomePage").then((m) => ({ default: m.HomePage })),
);

const LazyDashboardPage = lazy(() =>
  import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);

const LazyAboutPage = lazy(() =>
  import("@/pages/AboutPage").then((m) => ({ default: m.AboutPage })),
);

function SuspensePage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

export const routes: RouteObject[] = [
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
        path: "dashboard",
        element: (
          <SuspensePage>
            <LazyDashboardPage />
          </SuspensePage>
        ),
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
