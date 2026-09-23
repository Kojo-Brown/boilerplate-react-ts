import { Suspense, type ReactNode } from "react";
import { Outlet, ScrollRestoration } from "react-router";
import { Navbar } from "@/widgets/layout/Navbar";
import { Sidebar } from "@/widgets/layout/Sidebar";
import { RoutePendingBar } from "@/features/route-transition/RoutePendingBar";
import { RouteTransitionProvider } from "@/features/route-transition/routeTransition";
import { RoutePrefetchProvider } from "@/features/route-prefetch/routePrefetch";
import { WebVitalsReporter } from "@/shared/analytics/WebVitalsReporter";
import { ErrorBreadcrumbs } from "@/features/route-errors/ErrorBreadcrumbs";
import { OfflineIndicators } from "@/features/offline/OfflineIndicators";
import { RouteAnnouncer } from "@/features/route-announcement/RouteAnnouncer";
import { MAIN_CONTENT_ID, SkipLink } from "@/shared/ui/SkipLink";
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
            First in the DOM because that is the whole of how a skip link
            works: it has to be the first thing Tab reaches, and "first" is
            document order, not the `z-index` or the `top: 0` that make it
            visible once it gets there.

            One link, not the usual pair. "Skip to navigation" is the other
            half of the convention and is deliberately absent: both of this
            app's navs are already above the main content — the header's is
            two Tab presses from here and the sidebar's is next after it — so a
            link to them would skip nothing, and on a phone the header nav is
            `display: none`, which makes it a link to a place focus cannot go.
          */}
          <SkipLink targetId={MAIN_CONTENT_ID}>Skip to main content</SkipLink>
          {/*
            Renders one visually-hidden live region and moves focus to `<main>`
            after each navigation. In the shell rather than per route for the
            same reason as the reporters above — it needs to see the route
            change, which means outliving it — and next to `RoutePendingBar`,
            which announces the other end of the same event: that one says a
            navigation started, this one says which page arrived.
          */}
          <RouteAnnouncer />
          {/*
            Renders nothing; it is here rather than in `main.tsx` because the
            collector attributes each metric to the route showing when the
            metric was reported, and that needs router context. Inside the
            shell rather than around a page so it outlives every navigation —
            LCP and CLS belong to the page *load*, and a reporter that
            remounted per route would start a new visit on every link click.
          */}
          <WebVitalsReporter />
          {/*
            Also renders nothing, and here for the same two reasons: a
            navigation crumb needs router context, and a recorder remounted per
            route would hand every error an empty trail — the head of which is
            the part worth having.
          */}
          <ErrorBreadcrumbs />
          <ScrollRestoration />
          <RoutePendingBar />
          <Navbar />
          {/*
            Renders nothing while the connection is up, the write queue is
            empty and nothing has been lost, which is why it can sit in the
            shell rather than on a page: offline state belongs to the session,
            not to the route the user happens to be on when the network drops.

            One component rather than the two indicators it contains, and that
            is load-bearing rather than tidiness — it holds the shell's single
            subscription to the offline store. A second store read above every
            route is paid for by every deferred update beneath it; see
            `OfflineIndicators.tsx`.
          */}
          <OfflineIndicators className="mx-4 mt-3" />
          <div className="flex flex-1">
            <Sidebar />
            {/*
              A `<main>` landmark, which this layout did not have: the routed
              page was in an anonymous `<div>`, so "skip to the content" and
              "jump to main" had nothing to name.

              `tabIndex={-1}` makes it focusable without putting it in the tab
              order, which is what both the skip link and the route announcer
              need — an element that is not focusable swallows a `focus()`
              silently and leaves focus on `<body>`.
            */}
            <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 overflow-y-auto">
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
            </main>
          </div>
        </div>
      </RoutePrefetchProvider>
    </RouteTransitionProvider>
  );
}
