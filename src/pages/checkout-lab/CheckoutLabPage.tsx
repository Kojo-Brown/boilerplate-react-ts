import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { CheckoutFlow } from "@/features/checkout/CheckoutFlow";
import { Text } from "@/shared/ui/Text";
import { cn } from "@/shared/lib/cn";
import { createInMemoryCheckoutApi } from "@/features/checkout/checkoutApi";
import {
  CHECKOUT_SERVER_MODES,
  DEMO_CART,
  SERVER_MODE_LABELS,
  failureForMode,
  parseCheckoutLatency,
  parseCheckoutServerMode,
} from "@/pages/checkout-lab/checkoutLabParams";

/**
 * Harness for the state-machine pattern.
 *
 * The server's behaviour lives in the URL (`?server=declined&latency=3000`) so
 * a run is shareable and the states that are awkward to reach against a healthy
 * backend are one click away: a request slow enough to cancel, a rejection the
 * server blames on the payment step, and one it blames on nobody.
 *
 * Four things here are worth driving by hand rather than reading about.
 *
 * Press Continue with an empty basket. The button is live, the machine refuses,
 * and a sentence appears — a guard on its own would have produced a dead
 * control and nothing to chase.
 *
 * Set a long latency, place an order, and press the buttons underneath. The
 * second Place order does nothing because `submitting` has no transition for
 * it; Cancel aborts the request rather than ignoring its result.
 *
 * Run the declined server and watch where you land: back on the payment step
 * with the reason attached, not on an error screen with a Try again that would
 * decline identically. Run the outage server for the opposite treatment.
 *
 * Watch the commit counter next to the running total while typing an address.
 * The whole flow re-renders on every keystroke; the total does not, because it
 * subscribes to a slice with `useSelector`.
 */
export function CheckoutLabPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const server = parseCheckoutServerMode(searchParams.get("server"));
  const latencyMs = parseCheckoutLatency(searchParams.get("latency"));

  // Re-created when the knobs change so the fake server starts from a known
  // state. `useMachine` reads its `input` once, when the actor is created, so
  // a new API object alone would change nothing — the `key` below is what
  // rebuilds the actor around it.
  const api = useMemo(
    () => createInMemoryCheckoutApi({ latencyMs, failWhen: failureForMode(server) }),
    [server, latencyMs],
  );

  const setParam = (key: string, value: string): void => {
    const params = new URLSearchParams(searchParams);
    params.set(key, value);
    setSearchParams(params, { replace: true });
  };

  return (
    <main className="flex flex-col gap-8 p-8">
      <header className="flex flex-col gap-2">
        <Text as="h1" size="2xl" weight="bold">
          Checkout Machine Lab
        </Text>
        <Text tone="muted" className="max-w-2xl">
          Four steps, one actor. The rules that matter here are not enforced by disabled buttons —
          they are enforced by the absence of a transition. Try to leave an empty basket, try to
          submit twice, and cancel an order mid-flight.
        </Text>
      </header>

      <div className="flex flex-wrap items-center gap-6">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Server mode">
          {CHECKOUT_SERVER_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={server === mode}
              data-testid={`server-${mode}`}
              onClick={() => {
                setParam("server", mode);
              }}
              className={cn(
                "rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1 text-xs",
                server === mode
                  ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
                  : "hover:bg-[var(--color-muted)]",
              )}
            >
              {SERVER_MODE_LABELS[mode]}
            </button>
          ))}
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
            <option value="700">700 ms</option>
            <option value="4000">4 s</option>
          </select>
        </label>
      </div>

      {/*
        The `key` is load-bearing rather than defensive. `useMachine` builds its
        actor on mount and reads `input` exactly once; without a remount, a new
        API object would sit in a prop nothing reads again and the buttons above
        would appear to do nothing at all.
      */}
      <CheckoutFlow key={`${server}-${latencyMs}`} cart={DEMO_CART} api={api} />
    </main>
  );
}
