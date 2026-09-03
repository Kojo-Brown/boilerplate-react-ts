export const ROUTES = {
  HOME: "/",
  DASHBOARD: "/dashboard",
  ABOUT: "/about",
  CONCURRENCY_LAB: "/labs/concurrency",
  OPTIMISTIC_LAB: "/labs/optimistic",
  USE_API_LAB: "/labs/use",
  ACTIONS_LAB: "/labs/actions",
  STREAMING_LAB: "/labs/streaming",
  NAVIGATION_LAB: "/labs/navigation",
  HEADLESS_LAB: "/labs/headless",
  POLYMORPHIC_LAB: "/labs/polymorphic",
  RENDER_PROPS_LAB: "/labs/render-props",
  CHECKOUT_LAB: "/labs/checkout",
  DEPENDENCY_INVERSION_LAB: "/labs/dependency-inversion",
  WORKER_LAB: "/labs/workers",
  INFINITE_SCROLL_LAB: "/labs/infinite-scroll",
  PREFETCH_LAB: "/labs/prefetch",
  LOGIN: "/login",
  OAUTH_CALLBACK: "/auth/callback",
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

/** Type-safe navigation helper — prevents navigating to unregistered paths. */
export function typedRoute(path: AppRoute): AppRoute {
  return path;
}
