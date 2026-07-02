import { useNavigate } from "react-router";
import { Button } from "@/components/ui/Button";
import { ROUTES } from "@/router/paths";

export function DashboardPage() {
  const navigate = useNavigate();

  return (
    <main className="flex flex-col items-center justify-center gap-6 p-8 py-16">
      <h1 className="text-4xl font-bold tracking-tight">Dashboard</h1>
      <p className="max-w-md text-center text-[var(--color-muted-fg)]">
        This page is lazy-loaded via React Router 7.
      </p>
      <div className="flex gap-3">
        <Button onClick={() => navigate(ROUTES.HOME)}>Go Home</Button>
        <Button variant="secondary" onClick={() => navigate(ROUTES.ABOUT)}>
          About
        </Button>
      </div>
    </main>
  );
}
