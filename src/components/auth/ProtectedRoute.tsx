import { Navigate, Outlet, useLocation } from "react-router";
import { useAppSelector } from "@/store";
import { ROUTES } from "@/router/paths";
import type { UserRole } from "@/store/authSlice";

interface ProtectedRouteProps {
  redirectTo?: string | undefined;
  requiredRoles?: readonly UserRole[] | undefined;
}

export function ProtectedRoute({ redirectTo = ROUTES.LOGIN, requiredRoles }: ProtectedRouteProps) {
  const token = useAppSelector((state) => state.auth.token);
  const user = useAppSelector((state) => state.auth.user);
  const location = useLocation();

  if (!token) {
    return <Navigate to={redirectTo} state={{ from: location }} replace />;
  }

  if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.some((r) => r === user?.role)) {
    return <Navigate to={redirectTo} state={{ from: location }} replace />;
  }

  return <Outlet />;
}
