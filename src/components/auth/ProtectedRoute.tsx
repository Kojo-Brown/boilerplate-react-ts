import { Navigate, Outlet, useLocation } from "react-router";
import { useAppSelector } from "@/store";
import { ROUTES } from "@/router/paths";

interface ProtectedRouteProps {
  redirectTo?: string;
}

export function ProtectedRoute({ redirectTo = ROUTES.LOGIN }: ProtectedRouteProps) {
  const token = useAppSelector((state) => state.auth.token);
  const location = useLocation();

  if (!token) {
    return <Navigate to={redirectTo} state={{ from: location }} replace />;
  }

  return <Outlet />;
}
