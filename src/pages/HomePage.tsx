import { Button } from "@/components/ui/Button";

export function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold tracking-tight">React TS Boilerplate</h1>
      <p className="max-w-md text-center text-[var(--color-muted-fg)]">
        React 19 · TypeScript 6 · Vite 7 · TailwindCSS 4 · RTK 2 · TanStack Query 5
      </p>
      <div className="flex gap-3">
        <Button>Get Started</Button>
        <Button variant="secondary">View Docs</Button>
      </div>
    </main>
  );
}
