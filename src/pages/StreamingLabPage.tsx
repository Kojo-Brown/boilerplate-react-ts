import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/Button";
import { StreamingReport } from "@/components/suspense/StreamingReport";
import type { BoundaryLayout, LoadingStrategy } from "@/components/suspense/StreamingReport";
import { createInMemoryReportApi, wereConcurrent, type RequestEvent } from "@/lib/reportApi";
import { createReportCache } from "@/lib/reportCache";
import { cn } from "@/lib/cn";
import {
  REPORT_FAILURE_MESSAGE,
  parseBoundaryLayout,
  parseFailingSection,
  parseLoadingStrategy,
  parseReportLatency,
  reportLatencies,
  type FailingSection,
} from "@/pages/streamingLabParams";

/**
 * Harness for streaming Suspense boundaries.
 *
 * The configuration lives in the URL (`?boundaries=flat&loading=waterfall`) so
 * a run is shareable, and the four combinations are one click apart — the
 * comparison is the lesson, and it does not survive being described.
 *
 * The timeline underneath is the half that is otherwise invisible. Reveal
 * behaviour you can watch; whether a request was waiting on another request is
 * a claim about the network, and the page would look exactly the same either
 * way.
 */
export function StreamingLabPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const boundaries = parseBoundaryLayout(searchParams.get("boundaries"));
  const loading = parseLoadingStrategy(searchParams.get("loading"));
  const failing = parseFailingSection(searchParams.get("fail"));
  const latencyMs = parseReportLatency(searchParams.get("latency"));

  const [generation, setGeneration] = useState(0);

  const setParam = (key: string, value: string): void => {
    const params = new URLSearchParams(searchParams);
    params.set(key, value);
    setSearchParams(params, { replace: true });
  };

  return (
    <main className="flex flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Streaming Suspense Lab</h1>
        <p className="max-w-3xl text-[var(--color-muted-fg)]">
          Two independent choices. <strong>Boundaries</strong> decide when each piece is shown:
          nested reveals the header, then each section as its data lands, while flat holds the whole
          page until the slowest request settles. <strong>Loading</strong> decides when each request
          starts: prefetching runs all three together, while leaving each section to start its own
          means they cannot begin until the header has resolved. Nesting a boundary never makes a
          request start sooner.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2" role="group" aria-label="Boundary layout">
          <ModeButton current={boundaries} value="nested" param="boundaries" onSelect={setParam}>
            Nested boundaries
          </ModeButton>
          <ModeButton current={boundaries} value="flat" param="boundaries" onSelect={setParam}>
            One boundary
          </ModeButton>
        </div>

        <div className="flex items-center gap-2" role="group" aria-label="Loading strategy">
          <ModeButton current={loading} value="parallel" param="loading" onSelect={setParam}>
            Prefetch
          </ModeButton>
          <ModeButton current={loading} value="waterfall" param="loading" onSelect={setParam}>
            Waterfall
          </ModeButton>
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--color-muted-fg)]">
          Break
          <select
            value={failing}
            data-testid="failing-section-select"
            onChange={(event) => {
              setParam("fail", event.target.value);
            }}
            className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-[var(--color-fg)]"
          >
            <option value="none">Nothing</option>
            <option value="summary">Header</option>
            <option value="breakdown">Breakdown</option>
            <option value="activity">Activity</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-[var(--color-muted-fg)]">
          Latency
          <select
            value={String(latencyMs)}
            data-testid="report-latency-select"
            onChange={(event) => {
              setParam("latency", event.target.value);
            }}
            className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-[var(--color-fg)]"
          >
            <option value="0">Instant</option>
            <option value="400">Fast</option>
            <option value="1200">Normal</option>
            <option value="3000">Slow</option>
          </select>
        </label>

        <Button
          variant="secondary"
          data-testid="rerun-report"
          onClick={() => {
            setGeneration((current) => current + 1);
          }}
        >
          Run again
        </Button>
      </div>

      <ReportRun
        // Remounting is what makes a change take effect. A new cache handed to
        // the same subtree would be an update, and React Router runs
        // navigations in a transition — a suspended transition holds the
        // previous UI, so the old run's sections would sit under the new run's
        // controls. It is also the only honest way to re-measure: settled
        // promises never suspend again.
        key={`${boundaries}-${loading}-${failing}-${latencyMs}-${generation}`}
        boundaries={boundaries}
        loading={loading}
        failing={failing}
        latencyMs={latencyMs}
      />
    </main>
  );
}

interface ReportRunProps {
  boundaries: BoundaryLayout;
  loading: LoadingStrategy;
  failing: FailingSection;
  latencyMs: number;
}

/**
 * One run: one service, one cache, one timeline.
 *
 * Split out so all three share the subtree's lifetime — the page remounts this
 * whenever the configuration changes, which drops the previous run's settled
 * promises and its recorded events together. Keeping the timeline up here
 * while the cache lived elsewhere would let a stale log describe a fresh run.
 */
function ReportRun({ boundaries, loading, failing, latencyMs }: ReportRunProps) {
  const [events, setEvents] = useState<readonly RequestEvent[]>([]);

  const cache = useMemo(() => {
    const api = createInMemoryReportApi({
      latencyMs: reportLatencies(latencyMs),
      failWhen: (section) => (section === failing ? REPORT_FAILURE_MESSAGE : null),
      onEvent: (event) => {
        // Deferred on purpose: the first `start` events fire during
        // `StreamingReport`'s render, and setting state from there is an
        // update to one component while another is rendering.
        queueMicrotask(() => {
          setEvents((current) => [...current, event]);
        });
      },
    });
    return createReportCache(api);
  }, [failing, latencyMs]);

  return (
    <div className="flex flex-col gap-6">
      <StreamingReport cache={cache} boundaries={boundaries} loading={loading} />
      <RequestTimeline events={events} />
    </div>
  );
}

/**
 * The request log, and the one thing worth concluding from it.
 *
 * The verdict is computed rather than assumed from the selected strategy: the
 * claim being made is about what the service actually saw, and a control that
 * reported its own setting back would be decoration.
 */
function RequestTimeline({ events }: { events: readonly RequestEvent[] }) {
  const overlapped = wereConcurrent(events, "summary", "breakdown");

  return (
    <section
      data-testid="request-timeline"
      aria-labelledby="timeline-title"
      className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4"
    >
      <h2 id="timeline-title" className="text-base font-semibold">
        Request timeline
      </h2>
      <p data-testid="timeline-verdict" className="text-sm text-[var(--color-muted-fg)]">
        {events.length === 0
          ? "No requests yet."
          : overlapped
            ? "The header and the breakdown were in flight together — the sections did not wait."
            : "The breakdown only started after the header had settled — a waterfall."}
      </p>
      <ol className="flex flex-col gap-1 text-sm">
        {events.map((event, index) => (
          <li
            // Position in the log is the identity here: the same section
            // appears twice, and the list only ever grows at the end.
            key={`${event.section}-${event.kind}-${String(index)}`}
            className="flex items-center gap-3"
          >
            <span className="w-6 text-right text-[var(--color-muted-fg)] tabular-nums">
              {index + 1}
            </span>
            <span
              className={cn(
                "rounded px-2 py-0.5 text-xs font-medium",
                event.kind === "start"
                  ? "bg-[var(--color-muted)] text-[var(--color-fg)]"
                  : "bg-[var(--color-primary)] text-[var(--color-primary-fg)]",
              )}
            >
              {event.kind}
            </span>
            <span>{event.section}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

interface ModeButtonProps {
  current: string;
  value: string;
  param: string;
  onSelect: (key: string, value: string) => void;
  children: React.ReactNode;
}

function ModeButton({ current, value, param, onSelect, children }: ModeButtonProps) {
  return (
    <Button
      variant={current === value ? "primary" : "ghost"}
      aria-pressed={current === value}
      onClick={() => {
        onSelect(param, value);
      }}
    >
      {children}
    </Button>
  );
}
