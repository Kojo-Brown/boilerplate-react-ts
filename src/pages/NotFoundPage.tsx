import { Link } from "react-router";
import { Button } from "@/components/ui/Button";

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-6xl font-bold text-[var(--color-muted-fg)]">404</h1>
      <p className="text-xl font-medium">Page not found</p>
      <Button asChild>
        <Link to="/">Go home</Link>
      </Button>
    </main>
  );
}
