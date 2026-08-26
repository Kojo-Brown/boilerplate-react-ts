import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/shared/ui/Button";
import { InviteTeammateForm } from "@/features/invite/InviteTeammateForm";
import { createInMemoryInviteApi } from "@/features/invite/inviteApi";
import {
  INVITE_OUTAGE_MESSAGE,
  SEEDED_TEAM_EMAIL,
  parseInviteLatency,
  parseInviteServerMode,
  type InviteServerMode,
} from "@/pages/actions-lab/actionsLabParams";

/**
 * Harness for the `useActionState` + `useFormStatus` pattern.
 *
 * Server behaviour lives in the URL (`?server=failing&latency=1500`) so a run
 * is shareable and the states that are awkward to reach on a healthy backend —
 * a pending button you can actually read, and a request that fails after the
 * form has already been accepted — are one click away.
 *
 * Three failures are reachable from here, and they are deliberately different
 * from each other: a malformed address never leaves the browser, an address
 * that is already on the team is rejected by the server and lands under the
 * field anyway, and a failing service produces a form-level message with no
 * field to blame.
 */
export function ActionsLabPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const server = parseInviteServerMode(searchParams.get("server"));
  const latencyMs = parseInviteLatency(searchParams.get("latency"));

  // Re-created when the knobs change so the fake server starts from a known
  // team list; the `key` below resets the form's state to match.
  const api = useMemo(
    () =>
      createInMemoryInviteApi({
        existingEmails: [SEEDED_TEAM_EMAIL],
        latencyMs,
        failWhen: server === "failing" ? () => INVITE_OUTAGE_MESSAGE : undefined,
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
        <h1 className="text-3xl font-bold tracking-tight">Actions Lab</h1>
        <p className="max-w-2xl text-[var(--color-muted-fg)]">
          This form keeps no submit state of its own. The action returns the next state, React
          decides when it runs and whether it is still running, and the button reads that straight
          out of the form it sits in. Submit <code>{SEEDED_TEAM_EMAIL}</code> to see an error only
          the server could have produced land under the field, or break the service to see one that
          belongs to no field at all.
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
            <option value="600">600 ms</option>
            <option value="2000">2 s</option>
          </select>
        </label>
      </div>

      <div className="max-w-lg">
        <InviteTeammateForm
          // Remounts when the fake server is replaced, so a message about the
          // previous server cannot outlive it.
          key={`${server}-${latencyMs}`}
          api={api}
        />
      </div>
    </main>
  );
}

interface ServerButtonProps {
  current: InviteServerMode;
  value: InviteServerMode;
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
