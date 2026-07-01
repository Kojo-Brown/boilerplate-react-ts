import { useNavigate } from "react-router";
import { Button } from "@/components/ui/Button";
import { ROUTES } from "@/router/paths";

export function AboutPage() {
  const navigate = useNavigate();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold tracking-tight">About</h1>
      <p className="max-w-md text-center text-[var(--color-muted-fg)]">
        React 19 · TypeScript 6 · React Router 7 boilerplate with typed routes
        and lazy-loaded pages.
      </p>
      <div className="flex gap-3">
        <Button onClick={() => navigate(ROUTES.HOME)}>Go Home</Button>
        <Button variant="secondary" onClick={() => navigate(ROUTES.DASHBOARD)}>
          Dashboard
        </Button>
      </div>
    </main>
  );
}
