import type { ReactNode } from "react";
import { useAuth } from "@/features/auth/AuthContext";
import type { UserRole } from "@/entities/session/authSlice";

interface RoleGuardProps {
  roles: readonly UserRole[];
  fallback?: ReactNode;
  children: ReactNode;
}

export function RoleGuard({ roles, fallback = null, children }: RoleGuardProps) {
  const { hasAnyRole } = useAuth();
  return <>{hasAnyRole(roles) ? children : fallback}</>;
}
