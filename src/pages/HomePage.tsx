import { useNavigate } from "react-router";
import { Button } from "@/components/ui/Button";
import { ROUTES } from "@/router/paths";

export function HomePage() {
  const navigate = useNavigate();

  return (
    <main className="flex flex-col items-center justify-center gap-6 p-8 py-16">
      <h1 className="text-4xl font-bold tracking-tight">React TS Boilerplate</h1>
      <p className="max-w-md text-center text-[var(--color-muted-fg)]">
        React 19 · TypeScript 6 · Vite 7 · TailwindCSS 4 · RTK 2 · TanStack Query 5
      </p>
      <div className="flex gap-3">
        <Button onClick={() => navigate(ROUTES.DASHBOARD)}>Get Started</Button>
        <Button variant="secondary" onClick={() => navigate(ROUTES.ABOUT)}>
          About
        </Button>
      </div>
    </main>
  );
}
