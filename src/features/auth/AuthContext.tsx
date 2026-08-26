import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAppSelector, useAppDispatch } from "@/shared/store/hooks";
import { logout, type AuthUser, type UserRole } from "@/entities/session/authSlice";
import { usePersistedSession } from "@/entities/session/usePersistedSession";

export interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  hasRole: (role: UserRole) => boolean;
  hasAnyRole: (roles: readonly UserRole[]) => boolean;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const token = useAppSelector((state) => state.auth.token);

  usePersistedSession();

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isAuthenticated: token !== null && user !== null,
      hasRole: (role) => user !== null && user.role === role,
      hasAnyRole: (roles) => user !== null && roles.some((r) => r === user.role),
      signOut: () => dispatch(logout()),
    }),
    [user, token, dispatch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
