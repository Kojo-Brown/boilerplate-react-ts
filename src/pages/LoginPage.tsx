import { useLocation } from "react-router";
import { ROUTES } from "@/router/paths";

interface LocationState {
  from?: { pathname: string };
}

export function LoginPage() {
  const location = useLocation();
  const state = location.state as LocationState | null;
  const fromPath = state?.from?.pathname;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold tracking-tight">Sign In</h1>
      <p className="text-center text-[var(--color-muted-fg)]">
        {fromPath
          ? `You must be signed in to access ${fromPath}.`
          : "Please sign in to continue."}
      </p>
      <p className="text-sm text-[var(--color-muted-fg)]">
        Auth implementation coming in Phase 4 (
        <a className="underline" href={ROUTES.HOME}>
          go home
        </a>
        ).
      </p>
    </main>
  );
}
