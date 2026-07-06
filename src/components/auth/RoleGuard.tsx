import type { ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import type { UserRole } from "@/store/authSlice";

interface RoleGuardProps {
  roles: readonly UserRole[];
  fallback?: ReactNode;
  children: ReactNode;
}

export function RoleGuard({ roles, fallback = null, children }: RoleGuardProps) {
  const { hasAnyRole } = useAuth();
  return <>{hasAnyRole(roles) ? children : fallback}</>;
}
