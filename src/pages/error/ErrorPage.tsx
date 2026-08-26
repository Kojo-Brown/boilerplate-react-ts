import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router";
import { Button } from "@/shared/ui/Button";

interface ErrorDetails {
  status: number;
  title: string;
  message: string;
}

function getErrorDetails(error: unknown): ErrorDetails {
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return {
        status: 404,
        title: "Page not found",
        message: "The page you're looking for doesn't exist or has been moved.",
      };
    }
    return {
      status: error.status,
      title: "Request failed",
      message: error.statusText || "An unexpected server error occurred.",
    };
  }
  if (error instanceof Error) {
    return {
      status: 500,
      title: "Something went wrong",
      message: error.message,
    };
  }
  return {
    status: 500,
    title: "Something went wrong",
    message: "An unexpected error occurred.",
  };
}

export default function ErrorPage() {
  const error = useRouteError();
  const navigate = useNavigate();
  const { status, title, message } = getErrorDetails(error);

  function handleRetry() {
    window.location.reload();
  }

  function handleGoHome() {
    void navigate("/");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-8xl font-bold text-[var(--color-muted-fg)]" aria-hidden="true">
        {status}
      </p>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="max-w-md text-[var(--color-muted-fg)]">{message}</p>
      <div className="mt-2 flex gap-3">
        <Button variant="secondary" onClick={handleRetry}>
          Try again
        </Button>
        <Button onClick={handleGoHome}>Go home</Button>
      </div>
    </main>
  );
}
