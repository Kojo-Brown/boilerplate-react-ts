import { useNavigate } from "react-router";
import { Button } from "@/components/ui/Button";

export function NotFoundPage() {
  const navigate = useNavigate();

  function handleGoHome() {
    void navigate("/");
  }

  return (
    <main className="flex flex-col items-center justify-center gap-4 p-8 py-16 text-center">
      <p className="text-8xl font-bold text-[var(--color-muted-fg)]" aria-hidden="true">
        404
      </p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="max-w-md text-sm text-[var(--color-muted-fg)]">
        The page you&rsquo;re looking for doesn&rsquo;t exist or has been moved.
      </p>
      <Button onClick={handleGoHome}>Go home</Button>
    </main>
  );
}
