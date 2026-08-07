export const ROUTES = {
  HOME: "/",
  DASHBOARD: "/dashboard",
  ABOUT: "/about",
  CONCURRENCY_LAB: "/labs/concurrency",
  OPTIMISTIC_LAB: "/labs/optimistic",
  LOGIN: "/login",
  OAUTH_CALLBACK: "/auth/callback",
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

/** Type-safe navigation helper — prevents navigating to unregistered paths. */
export function typedRoute(path: AppRoute): AppRoute {
  return path;
}
