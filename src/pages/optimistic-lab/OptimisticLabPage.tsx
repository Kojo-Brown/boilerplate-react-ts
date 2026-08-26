import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/shared/ui/Button";
import { OptimisticTaskList } from "@/features/tasks/OptimisticTaskList";
import { createInMemoryTaskApi, type Task } from "@/entities/task/taskApi";
import {
  parseLatency,
  parseServerMode,
  type ServerMode,
} from "@/pages/optimistic-lab/optimisticLabParams";

const SEED_TASKS: readonly Task[] = [
  { id: "server-seed-1", title: "Read the rollback notes in the README", done: true },
  { id: "server-seed-2", title: "Break the server and add a task", done: false },
];

/**
 * Harness for the `useOptimistic` pattern.
 *
 * Server behaviour lives in the URL (`?server=failing&latency=800`) so a run is
 * shareable and so the failure path — the half of the pattern that is hard to
 * trigger on a healthy backend — is one click away rather than something you
 * have to unplug your network to see.
 */
export function OptimisticLabPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const server = parseServerMode(searchParams.get("server"));
  const latencyMs = parseLatency(searchParams.get("latency"));

  // Re-created when the knobs change so the fake server starts from a known
  // state; the `key` below resets the list's committed state to match.
  const api = useMemo(
    () =>
      createInMemoryTaskApi({
        initialTasks: SEED_TASKS,
        latencyMs,
        failWhen: server === "failing" ? () => "The server rejected this change." : undefined,
      }),
    [server, latencyMs],
  );

  const setParam = (key: string, value: string): void => {
    const params = new URLSearchParams(searchParams);
    params.set(key, value);
    setSearchParams(params, { replace: true });
  };

  return (
    <main className="flex flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Optimistic Lab</h1>
        <p className="max-w-2xl text-[var(--color-muted-fg)]">
          Every change here is drawn before the request is sent. With a healthy server the
          provisional row is replaced by the real one and you never see the seam. Switch the server
          to <strong>failing</strong> and the same change appears, then takes itself back off —
          nothing restores a snapshot, the guess is simply never committed.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2" role="group" aria-label="Server mode">
          <ServerButton current={server} value="healthy" onSelect={setParam}>
            Healthy server
          </ServerButton>
          <ServerButton current={server} value="failing" onSelect={setParam}>
            Failing server
          </ServerButton>
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--color-muted-fg)]">
          Latency
          <select
            value={String(latencyMs)}
            data-testid="latency-select"
            onChange={(event) => {
              setParam("latency", event.target.value);
            }}
            className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-[var(--color-fg)]"
          >
            <option value="0">Instant</option>
            <option value="400">400 ms</option>
            <option value="1500">1.5 s</option>
          </select>
        </label>
      </div>

      <OptimisticTaskList
        // Remounts when the fake server is replaced, so the committed list and
        // the server it is meant to mirror can never drift apart.
        key={`${server}-${latencyMs}`}
        initialTasks={SEED_TASKS}
        api={api}
      />
    </main>
  );
}

interface ServerButtonProps {
  current: ServerMode;
  value: ServerMode;
  onSelect: (key: string, value: string) => void;
  children: React.ReactNode;
}

function ServerButton({ current, value, onSelect, children }: ServerButtonProps) {
  return (
    <Button
      variant={current === value ? "primary" : "ghost"}
      aria-pressed={current === value}
      onClick={() => {
        onSelect("server", value);
      }}
    >
      {children}
    </Button>
  );
}
