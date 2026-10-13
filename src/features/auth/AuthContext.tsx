import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAppSelector, useAppDispatch } from "@/shared/store/hooks";
import { logout, type AuthUser, type UserRole } from "@/entities/session/authSlice";
import { useSessionExpiry } from "@/entities/session/useSessionExpiry";

export interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  /**
   * A restore from the refresh cookie is in flight and the outcome is unknown.
   *
   * Exposed because `!isAuthenticated` stopped meaning "signed out" when the
   * access token stopped being persisted: for the first round trip of every
   * reload it means "not yet known". A component that renders a sign-in prompt
   * on `!isAuthenticated` alone will flash it at every returning user, so the
   * distinction has to be reachable from the context rather than only from the
   * slice.
   */
  isRestoring: boolean;
  hasRole: (role: UserRole) => boolean;
  hasAnyRole: (roles: readonly UserRole[]) => boolean;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const token = useAppSelector((state) => state.auth.token);
  const status = useAppSelector((state) => state.auth.status);

  useSessionExpiry();

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isAuthenticated: token !== null && user !== null,
      isRestoring: status === "restoring",
      hasRole: (role) => user !== null && user.role === role,
      hasAnyRole: (roles) => user !== null && roles.some((r) => r === user.role),
      signOut: () => dispatch(logout()),
    }),
    [user, token, status, dispatch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
