import type { ChunkRegistry } from "@/shared/lib/idlePrefetchQueue";
import { ROUTES } from "@/shared/routes/paths";

/**
 * The navigation lab's destination. Not in `ROUTES` because nothing navigates
 * to it by name — the lab links to it, and the router owns the path.
 */
export const SLOW_ROUTE_PATH = "/labs/navigation/slow";

/**
 * Every lazily-loaded route, keyed by the href that reaches it.
 *
 * One registry, two consumers: the router builds its `React.lazy` components
 * from these thunks, and `<RoutePrefetchProvider>` prefetches through the same
 * ones. That is the whole reason the file exists. `React.lazy` exposes no
 * `preload`, so a prefetcher has to issue an `import()` of its own — and if it
 * writes that specifier itself, nothing connects the two. A renamed page then
 * leaves a prefetcher warming a module the router no longer renders: no type
 * error (the string still resolves), no test failure, no visible symptom, just
 * a feature quietly buying the wrong bytes. Sharing the thunk makes the
 * router's chunk and the prefetcher's chunk the same expression.
 *
 * The specifiers stay literal. Vite's static analysis is what turns each one
 * into a chunk, and a computed specifier would produce a glob — or nothing.
 *
 * It lives in `app/` because `fsd/layer-imports` also checks dynamic
 * `import()`, so `@/pages/…` may only be named from the composition root. The
 * registry is handed down to the provider; see `docs/route-prefetch.md`.
 */
export const routeChunks = {
  [ROUTES.HOME]: () => import("@/pages/home/HomePage"),
  [ROUTES.DASHBOARD]: () => import("@/pages/dashboard/DashboardPage"),
  [ROUTES.ABOUT]: () => import("@/pages/about/AboutPage"),
  [ROUTES.LOGIN]: () => import("@/pages/login/LoginPage"),
  [ROUTES.OAUTH_CALLBACK]: () => import("@/pages/oauth-callback/OAuthCallbackPage"),
  [ROUTES.CONCURRENCY_LAB]: () => import("@/pages/concurrency-lab/ConcurrencyLabPage"),
  [ROUTES.OPTIMISTIC_LAB]: () => import("@/pages/optimistic-lab/OptimisticLabPage"),
  [ROUTES.USE_API_LAB]: () => import("@/pages/use-api-lab/UseApiLabPage"),
  [ROUTES.ACTIONS_LAB]: () => import("@/pages/actions-lab/ActionsLabPage"),
  [ROUTES.STREAMING_LAB]: () => import("@/pages/streaming-lab/StreamingLabPage"),
  [ROUTES.NAVIGATION_LAB]: () => import("@/pages/navigation-lab/NavigationLabPage"),
  [ROUTES.HEADLESS_LAB]: () => import("@/pages/headless-lab/HeadlessLabPage"),
  [ROUTES.POLYMORPHIC_LAB]: () => import("@/pages/polymorphic-lab/PolymorphicLabPage"),
  [ROUTES.RENDER_PROPS_LAB]: () => import("@/pages/render-props-lab/RenderPropsLabPage"),
  [ROUTES.CHECKOUT_LAB]: () => import("@/pages/checkout-lab/CheckoutLabPage"),
  [ROUTES.DEPENDENCY_INVERSION_LAB]: () =>
    import("@/pages/dependency-inversion-lab/DependencyInversionLabPage"),
  [ROUTES.WORKER_LAB]: () => import("@/pages/worker-lab/WorkerLabPage"),
  [ROUTES.INFINITE_SCROLL_LAB]: () => import("@/pages/infinite-scroll-lab/InfiniteScrollLabPage"),
  [ROUTES.PREFETCH_LAB]: () => import("@/pages/prefetch-lab/PrefetchLabPage"),
  [SLOW_ROUTE_PATH]: () => import("@/pages/navigation-lab/SlowRouteLabPage"),
} as const satisfies ChunkRegistry;
