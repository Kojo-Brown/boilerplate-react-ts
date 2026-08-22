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
  LOGIN: "/login",
  OAUTH_CALLBACK: "/auth/callback",
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

/** Type-safe navigation helper — prevents navigating to unregistered paths. */
export function typedRoute(path: AppRoute): AppRoute {
  return path;
}
