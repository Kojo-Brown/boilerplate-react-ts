import { Suspense } from "react";
import { Outlet, ScrollRestoration } from "react-router";
import { Navbar } from "@/components/layout/Navbar";
import { Sidebar } from "@/components/layout/Sidebar";
import { RoutePendingBar } from "@/components/navigation/RoutePendingBar";
import { RouteFallback } from "@/router/RouteFallback";
import { RouteTransitionProvider } from "@/router/routeTransition";

export function RootLayout() {
  return (
    <RouteTransitionProvider>
      <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
        <ScrollRestoration />
        <RoutePendingBar />
        <Navbar />
        <div className="flex flex-1">
          <Sidebar />
          <div className="flex-1 overflow-y-auto">
            {/*
              One boundary for every route under this layout, and it has to be
              here rather than around each route element.

              A transition holds the previous page only where React can keep
              showing already-revealed content, and "already revealed" belongs
              to a Suspense boundary *instance*. Per-route boundaries mount a
              new instance on arrival, which has nothing revealed yet, so React
              commits its fallback immediately and the previous page is gone —
              transition or no transition. Whether two route elements happened
              to reconcile onto the same boundary decided whether a given
              navigation flashed, and nothing in the route config showed which.
              Hoisting it here makes the boundary outlive every route swap, so
              the answer is the same for all of them.
            */}
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </div>
        </div>
      </div>
    </RouteTransitionProvider>
  );
}
