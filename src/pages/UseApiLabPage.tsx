import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/Button";
import { ProfilePanel } from "@/components/suspense/ProfilePanel";
import { ProfileCacheProvider } from "@/context/ProfileCacheProvider";
import { createInMemoryProfileApi, DEMO_PROFILES } from "@/lib/profileApi";
import { createPromiseCache } from "@/lib/promiseCache";
import {
  FAILING_PROFILE_ID,
  PROFILE_FAILURE_MESSAGE,
  parseProfileLatency,
  parseProfileServerMode,
  type ProfileServerMode,
} from "@/pages/useApiLabParams";

/**
 * Harness for the `use()` pattern.
 *
 * Server behaviour lives in the URL (`?server=failing&latency=1500`) so a run
 * is shareable and the two states that are awkward to reach on a healthy
 * backend — a fallback you can actually read, and a rejected request — are one
 * click away.
 *
 * The two panels have separate boundaries, so the failing server takes out
 * exactly one card. That is the visible argument for putting boundaries close
 * to the data rather than around the page.
 */
export function UseApiLabPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const server = parseProfileServerMode(searchParams.get("server"));
  const latencyMs = parseProfileLatency(searchParams.get("latency"));

  // Bumped by "Reload profiles". Rebuilding the cache is how you refetch with
  // `use()` — there is no `refetch()`, the promise *is* the request, so a new
  // request means a new cache entry.
  const [generation, setGeneration] = useState(0);

  const setParam = (key: string, value: string): void => {
    const params = new URLSearchParams(searchParams);
    params.set(key, value);
    setSearchParams(params, { replace: true });
  };

  return (
    <main className="flex flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">use() Lab</h1>
        <p className="max-w-2xl text-[var(--color-muted-fg)]">
          Each card is written as if its data were already there — no loading flag, no undefined
          branch. <code>use()</code> unwraps the promise and Suspense supplies the rest. Slow the
          server down to read the fallback, or break it to watch a rejected promise land in an error
          boundary while the card beside it carries on.
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
            data-testid="profile-latency-select"
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

        <Button
          variant="secondary"
          data-testid="reload-profiles"
          onClick={() => {
            setGeneration((current) => current + 1);
          }}
        >
          Reload profiles
        </Button>
      </div>

      <ProfileGrid
        // Remounting, rather than handing the same subtree a new cache, is what
        // makes a switch take effect. Swapping the cache in place is an update,
        // and React Router runs navigations inside a transition — a transition
        // that suspends holds the *previous* UI on screen until the new data is
        // ready, which here means cards from the old server sitting under the
        // new server's controls. `generation` is in the key for the same
        // reason: it is how "Reload profiles" forces a fresh mount.
        key={`${server}-${latencyMs}-${generation}`}
        server={server}
        latencyMs={latencyMs}
      />

      <p className="max-w-2xl text-sm text-[var(--color-muted-fg)]">
        Reloading builds a new cache rather than clearing the old one. Both would refetch, but a new
        cache is what makes the cards read new promises instead of the settled ones they already
        have.
      </p>
    </main>
  );
}

interface ProfileGridProps {
  server: ProfileServerMode;
  latencyMs: number;
}

/**
 * Owns the cache for one server configuration.
 *
 * Split out so the cache's lifetime is the component's: the page remounts this
 * subtree whenever the configuration changes, which is both how the new server
 * takes effect and how the previous server's settled promises are dropped.
 */
function ProfileGrid({ server, latencyMs }: ProfileGridProps) {
  const cache = useMemo(() => {
    const api = createInMemoryProfileApi({
      latencyMs,
      failWhen:
        server === "failing"
          ? (id) => (id === FAILING_PROFILE_ID ? PROFILE_FAILURE_MESSAGE : null)
          : undefined,
    });
    return createPromiseCache({ load: (id: string) => api.fetchProfile(id) });
  }, [server, latencyMs]);

  return (
    <ProfileCacheProvider cache={cache}>
      <div className="grid gap-4 sm:grid-cols-2">
        {DEMO_PROFILES.map((profile) => (
          <ProfilePanel key={profile.id} userId={profile.id} />
        ))}
      </div>
    </ProfileCacheProvider>
  );
}

interface ServerButtonProps {
  current: ProfileServerMode;
  value: ProfileServerMode;
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
