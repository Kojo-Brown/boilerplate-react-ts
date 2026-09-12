import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Text } from "@/shared/ui/Text";
import { Button } from "@/shared/ui/Button";
import { cn } from "@/shared/lib/cn";
import { ErrorReporterProvider } from "@/shared/observability/ErrorReporterProvider";
import { RouteErrorBoundary } from "@/features/route-errors/RouteErrorBoundary";
import { createMemoryTransport, createReporter } from "@/shared/observability/errorReporter";
import { createBreadcrumbBuffer } from "@/shared/observability/breadcrumbs";
import type { ErrorEvent } from "@/shared/observability/errorEvent";

/**
 * The four failures worth being able to reach on demand.
 *
 * `chunk` reproduces a stale deploy without needing one: the message is the
 * spelling Chromium uses, which is what `classifyRouteError` keys on, so the
 * fallback takes the reload-only branch exactly as it would against a real
 * 404 on a hashed chunk.
 */
const MODES = {
  none: { label: "Working", description: "Nothing throws." },
  render: {
    label: "Render error",
    description: "A plain throw during render. Retrying can fix it — and here it does.",
  },
  deterministic: {
    label: "Deterministic error",
    description: "Throws every time. Watch the retry button give up and offer a reload.",
  },
  chunk: {
    label: "Stale chunk",
    description:
      "What a deploy during an open tab looks like. Never offered a retry: React.lazy has memoised the rejection, so a reset rethrows it unchanged.",
  },
  nonError: {
    label: "Thrown string",
    description: '`throw "…"` — legal, and what a naive `error.message` renders as blank.',
  },
} as const;

type Mode = keyof typeof MODES;

function isMode(value: string | null): value is Mode {
  return value !== null && Object.hasOwn(MODES, value);
}

/** Throws according to the mode. `attempt` is what makes `render` recoverable. */
function Subject({ mode, attempt }: { mode: Mode; attempt: number }): ReactNode {
  if (mode === "render" && attempt === 0) {
    throw new Error("Could not read the dashboard summary", {
      cause: new Error("ECONNREFUSED 127.0.0.1:5432"),
    });
  }
  if (mode === "deterministic") {
    throw new TypeError("Cannot read properties of undefined (reading 'total')");
  }
  if (mode === "chunk") {
    throw new TypeError(
      "Failed to fetch dynamically imported module: https://app.example/assets/Report-4f21ab.js",
    );
  }
  if (mode === "nonError") {
    // The point of this arm: `throw` accepts any value, and both the reporter
    // and the fallback have to survive one that is not an Error.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw "the server said no";
  }
  return (
    <div
      data-testid="lab-subject"
      className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-6"
    >
      <Text weight="semibold">Subject rendered successfully.</Text>
      <Text size="sm" className="text-[var(--color-muted-fg)]">
        {attempt > 0 ? `Recovered on attempt ${attempt}.` : "Nothing has thrown."}
      </Text>
    </div>
  );
}

function EventRow({ event }: { event: ErrorEvent }) {
  return (
    <li className="flex flex-col gap-1 border-t border-[var(--color-border)] py-2 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-xs text-[var(--color-muted-fg)]">{event.eventId.slice(0, 8)}</code>
        <Text size="sm" weight="semibold">
          {event.exception[0]?.type}: {event.exception[0]?.value}
        </Text>
      </div>
      <Text size="xs" className="text-[var(--color-muted-fg)]">
        fingerprint: <code>{event.fingerprint.join(" | ")}</code>
      </Text>
      <Text size="xs" className="text-[var(--color-muted-fg)]">
        tags:{" "}
        <code>
          {Object.entries(event.tags)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ")}
        </code>
      </Text>
      {event.exception.length > 1 ? (
        <Text size="xs" className="text-[var(--color-muted-fg)]">
          caused by: <code>{event.exception[event.exception.length - 1]?.value}</code>
        </Text>
      ) : null}
      <Text size="xs" className="text-[var(--color-muted-fg)]">
        breadcrumbs: {event.breadcrumbs.length}
      </Text>
    </li>
  );
}

/**
 * Reference demo for per-route error boundaries.
 *
 * The lab publishes its **own** reporter over a memory transport, nested
 * inside the application's. That is the point of the provider being nestable:
 * the events the panel lists are the ones this subtree produced, so the table
 * is a readout rather than a mock, and nothing the lab throws on purpose is
 * posted to the real collector.
 *
 * The mode lives in the query string because a route boundary's reset key is
 * `location.key`, so changing the mode is a navigation and clears the error —
 * which is the behaviour worth being able to see. It is also what the E2E
 * drives.
 */
export function ErrorLabPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("mode");
  const mode: Mode = isMode(raw) ? raw : "none";

  const [attempt, setAttempt] = useState(0);
  const [, forceRead] = useState(0);

  const { reporter, sink } = useMemo(() => {
    const memory = createMemoryTransport();
    return {
      sink: memory,
      reporter: createReporter({
        transport: memory.transport,
        breadcrumbs: createBreadcrumbBuffer(),
        tags: { surface: "error-lab" },
        // Off, so pressing "Try again" against the deterministic arm shows one
        // row per attempt. The application keeps the default.
        dedupeWindowMs: 0,
      }),
    };
  }, []);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <Text as="h1" size="2xl" weight="bold">
          Route error boundaries
        </Text>
        <Text className="text-[var(--color-muted-fg)]">
          Each arm below throws from inside a <code>RouteErrorBoundary</code> identical to the ones
          the router wraps every route in. See <code>docs/error-boundaries.md</code>.
        </Text>
      </header>

      <section className="flex flex-col gap-3">
        <Text as="h2" size="lg" weight="semibold">
          Failure mode
        </Text>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(MODES) as Mode[]).map((candidate) => (
            <Button
              key={candidate}
              size="sm"
              variant={candidate === mode ? "primary" : "secondary"}
              data-testid={`mode-${candidate}`}
              onClick={() => {
                setAttempt(0);
                // A navigation, which is what clears the boundary.
                setParams(candidate === "none" ? {} : { mode: candidate });
              }}
            >
              {MODES[candidate].label}
            </Button>
          ))}
        </div>
        <Text size="sm" className="text-[var(--color-muted-fg)]" data-testid="mode-description">
          {MODES[mode].description}
        </Text>
      </section>

      <ErrorReporterProvider reporter={reporter}>
        <section className={cn("flex flex-col gap-3")}>
          <Text as="h2" size="lg" weight="semibold">
            Subject
          </Text>
          <RouteErrorBoundary route="/labs/errors" maxRetries={2}>
            <Subject mode={mode} attempt={attempt} />
          </RouteErrorBoundary>
          <Button
            size="sm"
            variant="ghost"
            data-testid="lab-heal"
            onClick={() => {
              setAttempt((a) => a + 1);
            }}
          >
            Heal the subject (then press Try again)
          </Button>
        </section>
      </ErrorReporterProvider>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <Text as="h2" size="lg" weight="semibold">
            Reported events
          </Text>
          <Button
            size="sm"
            variant="secondary"
            data-testid="refresh-events"
            onClick={() => {
              forceRead((n) => n + 1);
            }}
          >
            Refresh
          </Button>
        </div>
        <ul data-testid="event-list" className="flex flex-col">
          {sink.events.length === 0 ? (
            <Text size="sm" className="text-[var(--color-muted-fg)]">
              Nothing reported yet.
            </Text>
          ) : (
            sink.events.map((event) => <EventRow key={event.eventId} event={event} />)
          )}
        </ul>
      </section>
    </main>
  );
}
