import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/shared/ui/Button";
import { CachedTaskBoard } from "@/features/tasks/CachedTaskBoard";
import { createInMemoryTaskApi, type Task } from "@/entities/task/taskApi";
import { TASK_ROOT_KEY } from "@/entities/task/taskQueries";
import {
  parseFailingCall,
  parseLatency,
  type FailingCall,
} from "@/pages/query-cache-lab/queryCacheLabParams";

const SEED_TASKS: readonly Task[] = [
  { id: "server-seed-1", title: "Read docs/optimistic-cache.md", done: true },
  { id: "server-seed-2", title: "Break a verb and watch the rollback", done: false },
  { id: "server-seed-3", title: "Turn the latency up and overlap two changes", done: false },
];

const FAIL_LABELS: Record<FailingCall, string> = {
  none: "Healthy",
  create: "Reject adds",
  setDone: "Reject toggles",
  remove: "Reject deletes",
};

/**
 * Harness for optimistic writes into the TanStack Query cache.
 *
 * Which verb the server rejects and how slow it is both live in the URL
 * (`?fail=setDone&latency=3000`), so the interesting states are shareable and
 * the failure path — the half of the pattern a healthy backend never shows you
 * — is one click away.
 *
 * Three things to try:
 *
 * 1. **Healthy, instant.** Add a task. It appears in *both* panels' worth of
 *    truth at once — the patch runs against every cached list — while the
 *    counts above stay put until the refetch lands, because they are
 *    invalidated rather than guessed.
 * 2. **Reject toggles, 3s.** Tick a row. It moves to the other panel
 *    immediately and comes back three seconds later. Nothing restored a
 *    snapshot; the patch was removed and the cache re-derived.
 * 3. **Reject deletes, 8s.** Delete a row, then add a task before the delete
 *    fails. The deleted row returns and the added one stays. That is the case
 *    snapshot-and-restore gets wrong: its snapshot predates the add.
 */
export function QueryCacheLabPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const failing = parseFailingCall(searchParams.get("fail"));
  const latencyMs = parseLatency(searchParams.get("latency"));

  const api = useMemo(
    () =>
      createInMemoryTaskApi({
        initialTasks: SEED_TASKS,
        latencyMs,
        failWhen: (call) =>
          call.type === failing ? `The server rejected this ${call.type} call.` : null,
      }),
    [failing, latencyMs],
  );

  // The fake server is rebuilt when a knob moves, so the cached rows now
  // describe a server that no longer exists. Resetting is the honest fix, and
  // two details in it are load-bearing:
  //
  // - `resetQueries`, not `removeQueries`. Removing drops the entries and
  //   leaves the mounted observers holding a query that is gone, so the lists
  //   sit on "Loading…" forever. Resetting clears them *and* refetches the
  //   active ones, which is the whole intent.
  // - Skipped on the first run. The board's own effects have already started
  //   the initial fetch by the time a parent effect runs, and resetting on
  //   mount would throw it away.
  const previousApi = useRef(api);
  useEffect(() => {
    if (previousApi.current === api) return;
    previousApi.current = api;
    void queryClient.resetQueries({ queryKey: TASK_ROOT_KEY });
  }, [api, queryClient]);

  const setParam = (key: string, value: string): void => {
    const params = new URLSearchParams(searchParams);
    params.set(key, value);
    setSearchParams(params, { replace: true });
  };

  return (
    <main className="flex flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Query Cache Lab</h1>
        <p className="max-w-2xl text-[var(--color-muted-fg)]">
          The same task list as the <strong>Optimistic Lab</strong>, except the rows live in the
          TanStack Query cache and several views read them at once. A change is written into the
          cache before the request is sent, applied to <em>every</em> cached list, and taken back
          off if the request fails — without disturbing whatever else is in flight. The counts are
          invalidated instead of guessed, because only the server can answer them.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-6">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Server mode">
          {(Object.keys(FAIL_LABELS) as FailingCall[]).map((value) => (
            <Button
              key={value}
              variant={failing === value ? "primary" : "ghost"}
              aria-pressed={failing === value}
              data-testid={`fail-${value}`}
              onClick={() => {
                setParam("fail", value);
              }}
            >
              {FAIL_LABELS[value]}
            </Button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--color-muted-fg)]">
          Latency
          <select
            value={String(latencyMs)}
            data-testid="cache-latency-select"
            onChange={(event) => {
              setParam("latency", event.target.value);
            }}
            className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-[var(--color-fg)]"
          >
            <option value="0">Instant</option>
            <option value="600">600 ms</option>
            <option value="3000">3 s</option>
            <option value="8000">8 s</option>
          </select>
        </label>
      </div>

      <CachedTaskBoard api={api} filters={["all", "open", "done"]} />
    </main>
  );
}
