import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "@/shared/ui/Button";
import { ApiClientProvider } from "@/shared/api/ApiClientProvider";
import {
  createStubApiClient,
  type StubApiCall,
  type StubApiClient,
} from "@/shared/api/createStubApiClient";
import { PostFeed } from "@/entities/post/PostFeed";
import {
  STUB_POSTS,
  parseClientMode,
  type ClientMode,
} from "@/pages/dependency-inversion-lab/dependencyInversionLabParams";

/**
 * Harness for the injected API client.
 *
 * One component — `<PostFeed>` — rendered twice against two implementations of
 * the same port. `?client=live` leaves the application's real `fetch` client in
 * place (MSW answers it in dev, `page.route()` answers it under Playwright);
 * `?client=stub` puts a `createStubApiClient` over it for that subtree only.
 * The feed is identical in both; the only difference is which provider is
 * nearest.
 *
 * The recorded-calls list under the stub is the part worth looking at: it is
 * the same handle a test asserts on, so "which requests did this component
 * actually make" is answerable here and in `PostFeed.test.tsx` in the same way.
 */
export function DependencyInversionLabPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = parseClientMode(searchParams.get("client"));

  const setMode = (next: ClientMode): void => {
    const params = new URLSearchParams(searchParams);
    params.set("client", next);
    setSearchParams(params, { replace: true });
  };

  return (
    <main className="flex flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Dependency Inversion Lab</h1>
        <p className="max-w-2xl text-[var(--color-muted-fg)]">
          The feed below reads its API client from context and has no idea which one it got. Switch
          the client and nothing about the component changes — the same code renders from{" "}
          <code>fetch</code> or from a table of canned responses, which is exactly what a unit test
          and a Storybook story each need.
        </p>
      </header>

      <div className="flex items-center gap-2" role="group" aria-label="API client">
        <ModeButton current={mode} value="live" onSelect={setMode}>
          Live client
        </ModeButton>
        <ModeButton current={mode} value="stub" onSelect={setMode}>
          Stub client
        </ModeButton>
      </div>

      {/*
        Remounting on the toggle rather than swapping the provider's value in
        place. A live swap would work here, but it would also pass if the feed
        had cached the client from its first render — and that is the bug this
        pattern is most likely to grow. Keying on the mode means the switch is
        proven by a fresh mount reading fresh context.
      */}
      <ClientSwitch key={mode} mode={mode} />
    </main>
  );
}

interface ClientSwitchProps {
  mode: ClientMode;
}

/**
 * Owns the stub for one mode.
 *
 * `useMemo` rather than a module constant so each mount gets its own recorder;
 * a shared stub would accumulate calls from every visit and the list below
 * would stop meaning "what this mount asked for".
 */
function ClientSwitch({ mode }: ClientSwitchProps) {
  // Recorded calls are held as state rather than read off `stub.calls` during
  // render. The stub is a plain recorder, not a store: an array it mutates
  // cannot tell React anything changed, so a sibling reading it would render
  // "None yet" and stay there while the feed loaded beside it.
  const [calls, setCalls] = useState<readonly StubApiCall[]>([]);

  const stub = useMemo<StubApiClient>(
    () =>
      createStubApiClient({
        routes: { "GET /posts": STUB_POSTS },
        latencyMs: 150,
        onRequest: (call) => {
          setCalls((current) => [...current, call]);
        },
      }),
    [],
  );

  const queryClient = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    [],
  );

  if (mode === "live") {
    return (
      <section className="flex flex-col gap-3" aria-label="Live client">
        <p className="text-sm text-[var(--color-muted-fg)]">
          Served by the client from <code>app/main.tsx</code>: a real request to{" "}
          <code>GET /posts</code>.
        </p>
        <PostFeed />
      </section>
    );
  }

  return (
    // A second `QueryClient` for the stub subtree, and it is not decoration.
    // Query keys name what was asked for, not who was asked, so a stub sharing
    // the application's cache would render the live client's rows for a frame
    // before its own arrived — the swap would look half-applied. Swapping the
    // client means swapping the cache with it, which is the same reason
    // `renderWithProviders` builds one per test and a Storybook decorator
    // builds one per story.
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={stub}>
        <section className="flex flex-col gap-3" aria-label="Stub client">
          <p className="text-sm text-[var(--color-muted-fg)]">
            Served by <code>createStubApiClient</code>, published to this subtree only. No network
            is involved.
          </p>
          <PostFeed />
          <StubCallLog calls={calls} />
        </section>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}

interface StubCallLogProps {
  calls: readonly StubApiCall[];
}

/**
 * What the stub was asked for — the same list a test reads off `stub.calls`.
 */
function StubCallLog({ calls }: StubCallLogProps) {
  return (
    <div className="flex flex-col gap-1" data-testid="stub-call-log">
      <h2 className="text-sm font-semibold text-[var(--color-fg)]">Calls recorded by the stub</h2>
      {calls.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-fg)]">None yet.</p>
      ) : (
        <ul className="text-sm text-[var(--color-muted-fg)]">
          {calls.map((call, index) => (
            <li key={`${call.method}-${call.path}-${index}`}>
              <code>
                {call.method} {call.path}
              </code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ModeButtonProps {
  current: ClientMode;
  value: ClientMode;
  onSelect: (value: ClientMode) => void;
  children: React.ReactNode;
}

function ModeButton({ current, value, onSelect, children }: ModeButtonProps) {
  return (
    <Button
      variant={current === value ? "primary" : "ghost"}
      aria-pressed={current === value}
      data-testid={`client-mode-${value}`}
      onClick={() => {
        onSelect(value);
      }}
    >
      {children}
    </Button>
  );
}
