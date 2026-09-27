import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { announcer } from "@/shared/a11y/announcer";
import { useAnnounce } from "@/shared/a11y/useAnnounce";
import { useAsyncStatusAnnouncement } from "@/shared/a11y/useAsyncStatusAnnouncement";
import { useDebouncedAnnouncement } from "@/shared/a11y/useDebouncedAnnouncement";
import { useToast } from "@/shared/ui/Toast";
import { cn } from "@/shared/lib/cn";
import type { AsyncStatus } from "@/shared/a11y/useAsyncStatusAnnouncement";

/**
 * Harness for the app's live regions, with the regions' contents on screen.
 *
 * Everything this page demonstrates is normally invisible: four `sr-only` spans
 * whose text changes for a fraction of a second. So the panel on the right
 * mirrors them — what each region holds right now, and which half of each pair
 * is holding it — which turns "did that announce?" from a question you answer
 * with a screen reader into one you answer by looking.
 *
 * The mirror is a plain panel and not a live region itself. It shows *state*, it
 * is re-read whenever the user looks at it, and making it announce would double
 * every message on the page. That distinction is the one thing to take away from
 * here; `docs/live-regions.md` is the long version.
 *
 * What it does not show is the part that only a real screen reader can tell you:
 * whether a message interrupted, and whether the reader was still speaking the
 * last one. The regions' politeness is what decides that, and it is the reason
 * the assertive pair is separate elements rather than an attribute that flips.
 */

const LATENCIES = { fast: 120, slow: 900 } as const;
type Latency = keyof typeof LATENCIES;

const FRUIT = [
  "Apricot",
  "Blackberry",
  "Blackcurrant",
  "Blueberry",
  "Cherry",
  "Cranberry",
  "Damson",
  "Elderberry",
  "Gooseberry",
  "Greengage",
] as const;

function matchCount(query: string): number {
  const needle = query.trim().toLowerCase();
  if (needle === "") return FRUIT.length;
  return FRUIT.filter((fruit) => fruit.toLowerCase().includes(needle)).length;
}

function resultsAnnouncement(count: number): string {
  if (count === 0) return "No matches";
  return count === 1 ? "1 match" : `${count} matches`;
}

export function LiveRegionsLabPage() {
  const announce = useAnnounce();
  const { toast } = useToast();

  const [status, setStatus] = useState<AsyncStatus>("idle");
  const [latency, setLatency] = useState<Latency>("slow");
  const [shouldFail, setShouldFail] = useState(false);
  const [rowCount, setRowCount] = useState(0);
  const [query, setQuery] = useState("");

  const count = matchCount(query);

  useAsyncStatusAnnouncement({
    status,
    messages: {
      pending: "Loading the report",
      // Read only on the transition into `success`, by which point the row
      // count set in the same batch is the one this render has.
      success: `Report ready, ${rowCount} rows`,
      error: "The report could not be loaded",
    },
  });

  useDebouncedAnnouncement(query.trim() === "" ? null : resultsAnnouncement(count));

  const runQuery = (): void => {
    setStatus("pending");
    setTimeout(() => {
      if (shouldFail) {
        setStatus("error");
        return;
      }
      setRowCount((previous) => previous + 42);
      setStatus("success");
    }, LATENCIES[latency]);
  };

  return (
    <main className="flex flex-col gap-8 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Live Regions Lab</h1>
        <p className="max-w-3xl text-[var(--color-muted-fg)]">
          Every announcement this application makes goes through four visually hidden regions — two
          polite, two assertive — owned by one store rather than by the components that speak. The
          panel below mirrors them, so you can watch a queue drain, watch the same message land
          twice, and see which of the two halves of a pair is holding the text.
        </p>
      </header>

      <div className="flex flex-col gap-8 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-8">
          <Section
            title="Politeness"
            note="Polite waits for the current sentence to finish; assertive stops it mid-word. Two separate pairs of regions, because changing one region's politeness does not reliably apply to an announcement already in flight."
          >
            <div className="flex flex-wrap gap-3">
              <LabButton
                onClick={() => {
                  announce("Draft saved");
                }}
                testId="announce-polite"
              >
                Announce politely
              </LabButton>
              <LabButton
                onClick={() => {
                  announce("Your session expires in one minute", { politeness: "assertive" });
                }}
                testId="announce-assertive"
              >
                Announce assertively
              </LabButton>
            </div>
          </Section>

          <Section
            title="The same message twice"
            note="“No results” after “No results” is not a DOM mutation, so one region would go silent on the second press. Writing alternately into two makes every announcement an empty region gaining content — watch the slot number change."
          >
            <LabButton
              onClick={() => {
                announce("No results");
              }}
              testId="announce-repeat"
            >
              Announce “No results”
            </LabButton>
          </Section>

          <Section
            title="A burst"
            note="Four messages in one click. Two written in the same tick are one mutation, so the first would never exist at a moment anything could observe it — the queue writes one and waits. Identical messages still waiting are collapsed."
          >
            <LabButton
              onClick={() => {
                announce("Row 1 archived");
                announce("Row 2 archived");
                announce("Row 2 archived");
                announce("Row 3 archived");
              }}
              testId="announce-burst"
            >
              Announce four (one duplicated)
            </LabButton>
          </Section>

          <Section
            title="Toasts"
            note="The toast card is not a live region. It is removed after four seconds, which is less than a screen reader often needs to reach a message, so the announcement has to outlive the thing announcing it. Its queue comes from the variant: warning and danger interrupt, success does not."
          >
            <div className="flex flex-wrap gap-3">
              <LabButton
                onClick={() => {
                  toast({ title: "Changes saved", variant: "success" });
                }}
                testId="toast-success"
              >
                Success toast
              </LabButton>
              <LabButton
                onClick={() => {
                  toast({
                    title: "Upload failed",
                    description: "The file is larger than 10 MB",
                    variant: "danger",
                  });
                }}
                testId="toast-danger"
              >
                Danger toast
              </LabButton>
            </div>
          </Section>

          <Section
            title="Async status"
            note="A load under half a second announces only its result: “Loading…” followed 120ms later by the answer is two sentences for one event. Over half a second, the user is sitting in silence and the pending message is what tells them their click registered."
          >
            <div className="flex flex-wrap items-end gap-4">
              <fieldset className="flex flex-col gap-1">
                <legend className="text-sm font-medium text-[var(--color-fg)]">Latency</legend>
                <div className="flex gap-3">
                  {(["fast", "slow"] as const).map((option) => (
                    <label key={option} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="radio"
                        name="latency"
                        value={option}
                        checked={latency === option}
                        onChange={() => {
                          setLatency(option);
                        }}
                      />
                      <span className="text-[var(--color-fg)]">
                        {option} ({LATENCIES[option]}ms)
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={shouldFail}
                  onChange={(event) => {
                    setShouldFail(event.target.checked);
                  }}
                  data-testid="should-fail"
                />
                <span className="text-[var(--color-fg)]">Fail the request</span>
              </label>
              <LabButton onClick={runQuery} testId="run-query">
                Load the report
              </LabButton>
            </div>
            <p className="text-sm text-[var(--color-muted-fg)]">
              Status: <strong data-testid="query-status">{status}</strong>
            </p>
          </Section>

          <Section
            title="A count that changes as you type"
            note="The count changes on every keystroke and each change would interrupt the last, so it is announced once the typing stops. A keystroke that leaves the count unchanged does not restart the wait — the fact has been true the whole time."
          >
            <label className="flex max-w-xs flex-col gap-1 text-sm">
              <span className="text-[var(--color-fg)]">Filter fruit</span>
              <input
                type="text"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder="berry"
                data-testid="filter-input"
                className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
              />
            </label>
            <p className="text-sm text-[var(--color-muted-fg)]">
              Matching now: <strong data-testid="match-count">{count}</strong>
            </p>
          </Section>
        </div>

        <RegionMirror />
      </div>
    </main>
  );
}

/**
 * What the four regions hold, as ordinary visible text.
 *
 * Reads the announcer with `useSyncExternalStore`, which is the same thing
 * `<LiveRegions>` does — this page is a second subscriber, not a second owner,
 * so it can only ever show what was really written.
 */
function RegionMirror() {
  const state = useSyncExternalStore(announcer.subscribe, announcer.getState, announcer.getState);

  const rows = useMemo(
    () => [
      { label: "polite", region: state.polite },
      { label: "assertive", region: state.assertive },
    ],
    [state],
  );

  return (
    <aside
      aria-labelledby="region-mirror-heading"
      className="flex w-full shrink-0 flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 lg:w-80"
    >
      <h2 id="region-mirror-heading" className="text-lg font-semibold">
        The regions, right now
      </h2>
      <p className="text-sm text-[var(--color-muted-fg)]">
        A plain panel, not a live region. It shows state rather than news, and making it announce
        would say every message on this page twice.
      </p>
      {rows.map(({ label, region }) => (
        <div key={label} className="flex flex-col gap-1">
          <p className="text-xs font-semibold tracking-wide text-[var(--color-muted-fg)] uppercase">
            {label} · slot <span data-testid={`mirror-${label}-slot`}>{region.slot}</span>
          </p>
          <p
            data-testid={`mirror-${label}-text`}
            className={cn(
              "min-h-10 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-2 text-sm",
              region.text === "" ? "text-[var(--color-muted-fg)] italic" : "text-[var(--color-fg)]",
            )}
          >
            {region.text === "" ? "silent" : region.text}
          </p>
        </div>
      ))}
    </aside>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="max-w-2xl text-sm text-[var(--color-muted-fg)]">{note}</p>
      </div>
      {children}
    </section>
  );
}

function LabButton({
  onClick,
  testId,
  children,
}: {
  onClick: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="h-10 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
    >
      {children}
    </button>
  );
}
