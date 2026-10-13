import { Navigate, Outlet, useLocation } from "react-router";
import { useAppSelector } from "@/shared/store/hooks";
import { ROUTES } from "@/shared/routes/paths";
import { PageLoader } from "@/shared/ui/PageLoader";
import type { UserRole } from "@/entities/session/authSlice";

interface ProtectedRouteProps {
  redirectTo?: string | undefined;
  requiredRoles?: readonly UserRole[] | undefined;
}

/**
 * Renders the matched child route, or redirects, or waits.
 *
 * The third branch is new, and it is the one that makes the move off
 * `localStorage` survivable. A reload no longer starts with a token in hand: it
 * starts with a request in flight to `POST /auth/refresh`, because the only
 * durable part of the session is a cookie this code cannot read. For the length
 * of that round trip `token` is `null` while the user is, in fact, signed in.
 *
 * Redirecting on `!token` alone — the previous condition, which was correct
 * when the token was read synchronously out of storage — would therefore bounce
 * every returning user to `/login` on every reload, and then leave them there,
 * since the restore completing does not un-navigate them. Rendering
 * `<PageLoader />` while the status is `restoring` is what buys the round trip.
 * It costs an unauthenticated visitor nothing: nothing dispatches
 * `sessionRestoreStarted` unless a restore is genuinely running, so a cold
 * visit to a protected URL still redirects on the first render.
 */
export function ProtectedRoute({ redirectTo = ROUTES.LOGIN, requiredRoles }: ProtectedRouteProps) {
  const token = useAppSelector((state) => state.auth.token);
  const user = useAppSelector((state) => state.auth.user);
  const status = useAppSelector((state) => state.auth.status);
  const location = useLocation();

  if (status === "restoring") {
    return <PageLoader />;
  }

  if (!token) {
    return <Navigate to={redirectTo} state={{ from: location }} replace />;
  }

  if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.some((r) => r === user?.role)) {
    return <Navigate to={redirectTo} state={{ from: location }} replace />;
  }

  return <Outlet />;
}
