import { useNavigate, useLocation } from "react-router";
import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import { ROUTES } from "@/router/paths";
import { LoginForm, type LoginFormValues } from "@/components/forms/LoginForm";
import { useLoginMutation } from "@/features/auth/authApi";

interface LocationState {
  from?: { pathname: string };
}

function getErrorMessage(error: FetchBaseQueryError | { error: string }): string {
  if ("status" in error && typeof error.status === "number") {
    if (error.status === 401) return "Invalid email or password.";
    if (error.status === 422) return "Please check your input and try again.";
    if (error.status >= 500) return "Server error. Please try again later.";
  }
  return "Login failed. Please check your connection and try again.";
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const from = state?.from?.pathname ?? ROUTES.DASHBOARD;

  const [login, { error: loginError }] = useLoginMutation();

  async function handleSubmit(values: LoginFormValues): Promise<void> {
    try {
      await login(values).unwrap();
      void navigate(from, { replace: true });
    } catch {
      // Error is surfaced via loginError from useLoginMutation
    }
  }

  const errorMessage = loginError ? getErrorMessage(loginError as FetchBaseQueryError) : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-4xl font-bold tracking-tight">Sign In</h1>
        {errorMessage && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
          >
            {errorMessage}
          </div>
        )}
        <LoginForm onSubmit={handleSubmit} />
      </div>
    </main>
  );
}
