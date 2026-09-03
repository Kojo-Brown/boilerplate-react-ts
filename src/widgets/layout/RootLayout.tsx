import { Suspense, type ReactNode } from "react";
import { Outlet, ScrollRestoration } from "react-router";
import { Navbar } from "@/widgets/layout/Navbar";
import { Sidebar } from "@/widgets/layout/Sidebar";
import { RoutePendingBar } from "@/features/route-transition/RoutePendingBar";
import { RouteTransitionProvider } from "@/features/route-transition/routeTransition";
import { RoutePrefetchProvider } from "@/features/route-prefetch/routePrefetch";
import { WebVitalsReporter } from "@/shared/analytics/WebVitalsReporter";
import type { ChunkRegistry } from "@/shared/lib/idlePrefetchQueue";

export interface RootLayoutProps {
  /**
   * What the shell's one Suspense boundary shows while a route loads.
   *
   * Passed in rather than imported because choosing a skeleton means knowing
   * the routes, and the shell sits below them: the app's `RouteFallback` reads
   * the pathname to pick a per-page skeleton, so importing it here would have
   * the layout depend on every page it can host. It is required rather than
   * defaulted to a spinner — a forgotten fallback would still render, just
   * without the per-route skeletons that boundary exists to keep.
   */
  fallback: ReactNode;
  /**
   * The chunk loaders the nav links prefetch through.
   *
   * Passed in for the same reason as `fallback`, and one more: the loaders
   * name pages, and `fsd/layer-imports` checks dynamic `import()`, so only the
   * composition root may write them. Required rather than defaulted to `{}` —
   * an empty registry silently prefetches nothing, and nothing about a page
   * that loads on click instead of on hover looks wrong.
   */
  prefetchRegistry: ChunkRegistry;
}

export function RootLayout({ fallback, prefetchRegistry }: RootLayoutProps) {
  return (
    <RouteTransitionProvider>
      {/*
        Inside the transition provider and outside the shell, so the queue
        outlives every navigation: a prefetcher remounted per route would
        forget which chunks it had already warmed and re-request them.
      */}
      <RoutePrefetchProvider registry={prefetchRegistry}>
        <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
          {/*
            Renders nothing; it is here rather than in `main.tsx` because the
            collector attributes each metric to the route showing when the
            metric was reported, and that needs router context. Inside the
            shell rather than around a page so it outlives every navigation —
            LCP and CLS belong to the page *load*, and a reporter that
            remounted per route would start a new visit on every link click.
          */}
          <WebVitalsReporter />
          <ScrollRestoration />
          <RoutePendingBar />
          <Navbar />
          <div className="flex flex-1">
            <Sidebar />
            <div className="flex-1 overflow-y-auto">
              {/*
                One boundary for every route under this layout, and it has to
                be here rather than around each route element.

                A transition holds the previous page only where React can keep
                showing already-revealed content, and "already revealed"
                belongs to a Suspense boundary *instance*. Per-route boundaries
                mount a new instance on arrival, which has nothing revealed
                yet, so React commits its fallback immediately and the previous
                page is gone — transition or no transition. Whether two route
                elements happened to reconcile onto the same boundary decided
                whether a given navigation flashed, and nothing in the route
                config showed which. Hoisting it here makes the boundary
                outlive every route swap, so the answer is the same for all of
                them.
              */}
              <Suspense fallback={fallback}>
                <Outlet />
              </Suspense>
            </div>
          </div>
        </div>
      </RoutePrefetchProvider>
    </RouteTransitionProvider>
  );
}
