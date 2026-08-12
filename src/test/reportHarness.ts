import {
  DEMO_ACTIVITY,
  DEMO_BREAKDOWN,
  DEMO_SUMMARY,
  ReportApiError,
  type ReportApi,
  type ReportSectionName,
  type ReportSections,
  type RequestEvent,
} from "@/lib/reportApi";

export interface DeferredReportApi extends ReportApi {
  /** Settles the in-flight request for `section`. */
  resolve<K extends ReportSectionName>(section: K, value?: ReportSections[K]): Promise<void>;
  /** Rejects the in-flight request for `section`. */
  reject(section: ReportSectionName, message?: string): Promise<void>;
  /** Sections that have been requested, in the order they were requested. */
  requested(): readonly ReportSectionName[];
}

const DEFAULTS: ReportSections = {
  summary: DEMO_SUMMARY,
  breakdown: DEMO_BREAKDOWN,
  activity: DEMO_ACTIVITY,
};

/**
 * A {@link ReportApi} whose requests settle only when the test says so.
 *
 * The latency-driven service in `reportApi.ts` is right for the browser and
 * wrong for these assertions. Every claim here is about a *state between two
 * events* — the header is up and the breakdown is not, the sections have not
 * been requested yet — and reaching that state by picking latencies far enough
 * apart makes the test a race against however slow the machine is. Timers do
 * not stop for jsdom.
 *
 * So the ordering is stated rather than arranged: `resolve("summary")` is the
 * only thing that lets the summary land, and until it is called the assertion
 * window is open indefinitely.
 *
 * Settling has to be awaited inside an act scope, since it is what pushes a
 * boundary out of its fallback:
 *
 *   await actAsync(() => api.resolve("summary"));
 */
export function createDeferredReportApi(): DeferredReportApi {
  const events: RequestEvent[] = [];
  const gates = new Map<
    ReportSectionName,
    { settle: (value: unknown) => void; fail: (error: Error) => void }
  >();

  function request<K extends ReportSectionName>(section: K): Promise<ReportSections[K]> {
    events.push({ kind: "start", section });
    return new Promise<ReportSections[K]>((settle, fail) => {
      gates.set(section, { settle: settle as (value: unknown) => void, fail });
    });
  }

  function gateFor(section: ReportSectionName) {
    const gate = gates.get(section);
    if (gate === undefined) {
      throw new Error(
        `Section "${section}" has not been requested, so there is nothing to settle. ` +
          `Requested so far: ${events
            .filter((event) => event.kind === "start")
            .map((event) => event.section)
            .join(", ")}.`,
      );
    }
    gates.delete(section);
    events.push({ kind: "settle", section });
    return gate;
  }

  return {
    fetchSummary: () => request("summary"),
    fetchBreakdown: () => request("breakdown"),
    fetchActivity: () => request("activity"),
    timeline: () => [...events],

    requested: () => events.filter((event) => event.kind === "start").map((event) => event.section),

    async resolve(section, value) {
      gateFor(section).settle(value ?? DEFAULTS[section]);
      // The suspended component re-renders on a microtask once the promise it
      // is waiting on settles; yielding here means the caller's act scope
      // covers that work rather than closing before it happens.
      await Promise.resolve();
    },

    async reject(section, message = "Reporting service unavailable") {
      gateFor(section).fail(new ReportApiError(message));
      await Promise.resolve();
    },
  };
}
