export const ROUTES = {
  HOME: "/",
  DASHBOARD: "/dashboard",
  ABOUT: "/about",
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

/** Type-safe navigation helper — prevents navigating to unregistered paths. */
export function typedRoute(path: AppRoute): AppRoute {
  return path;
}
