/**
 * The demo domain for streaming Suspense boundaries.
 *
 * A report is deliberately *several* requests rather than one: a summary that
 * frames the page, a breakdown table that is slow, and an activity feed that is
 * quick. That asymmetry is the subject — which boundary a section sits behind
 * decides when it appears, and where its request is started decides whether it
 * waited on anything first.
 *
 * The service records a request timeline so those two questions can be
 * asserted directly instead of inferred from wall-clock timing, which would
 * make the tests flaky on a loaded CI runner.
 */

export interface ReportSummary {
  readonly title: string;
  readonly period: string;
  readonly totalRevenue: number;
  readonly orderCount: number;
}

export interface BreakdownRow {
  readonly channel: string;
  readonly orders: number;
  readonly revenue: number;
}

export interface ActivityEntry {
  readonly id: string;
  readonly at: string;
  readonly message: string;
}

/** The section-name → value-type mapping the report cache is built over. */
export interface ReportSections extends Record<string, unknown> {
  summary: ReportSummary;
  breakdown: readonly BreakdownRow[];
  activity: readonly ActivityEntry[];
}

/** The report's section names, in the order they appear on the page. */
export const REPORT_SECTIONS = ["summary", "breakdown", "activity"] as const;

export type ReportSectionName = (typeof REPORT_SECTIONS)[number];

/** Thrown by the in-memory service for an induced section failure. */
export class ReportApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportApiError";
  }
}

/** One thing that happened to one request. */
export interface RequestEvent {
  readonly kind: "start" | "settle";
  readonly section: ReportSectionName;
}

export interface ReportApi {
  fetchSummary(): Promise<ReportSummary>;
  fetchBreakdown(): Promise<readonly BreakdownRow[]>;
  fetchActivity(): Promise<readonly ActivityEntry[]>;
  /**
   * Every request start and settle, in order.
   *
   * Ordering, not timestamps. "Did these two overlap" is a question about
   * sequence, and answering it from durations would tie the assertion to how
   * busy the machine is.
   */
  timeline(): readonly RequestEvent[];
}

export interface InMemoryReportApiOptions {
  /**
   * Per-section round-trip time in ms. Missing sections settle on the next
   * macrotask.
   *
   * Even at 0 this goes through a timer rather than resolving synchronously:
   * a promise already settled when `use()` first sees it never suspends, so a
   * zero-latency service built on `Promise.resolve()` would quietly stop
   * exercising the Suspense path these tests exist to cover.
   */
  readonly latencyMs?: Partial<Record<ReportSectionName, number>> | undefined;
  /**
   * Return a message to make that section fail, or `null` to let it through.
   * A predicate rather than a failure rate, so an error-isolation test is
   * deterministic.
   */
  readonly failWhen?: ((section: ReportSectionName) => string | null) | undefined;
  /**
   * Called as each event is recorded, for a live view of the timeline.
   *
   * Fires synchronously, and a request can start during render — `prefetch`
   * is called from a component body on purpose. A subscriber that sets state
   * must therefore defer it (`queueMicrotask`), or React reports an update to
   * one component while another is rendering.
   */
  readonly onEvent?: ((event: RequestEvent) => void) | undefined;
  readonly summary?: ReportSummary | undefined;
  readonly breakdown?: readonly BreakdownRow[] | undefined;
  readonly activity?: readonly ActivityEntry[] | undefined;
}

export const DEMO_SUMMARY: ReportSummary = {
  title: "Q3 revenue report",
  period: "1 Jul – 30 Sep 2026",
  totalRevenue: 482_900,
  orderCount: 3_182,
};

export const DEMO_BREAKDOWN: readonly BreakdownRow[] = [
  { channel: "Direct", orders: 1284, revenue: 214_500 },
  { channel: "Marketplace", orders: 962, revenue: 148_200 },
  { channel: "Partner", orders: 611, revenue: 84_100 },
  { channel: "Wholesale", orders: 325, revenue: 36_100 },
];

export const DEMO_ACTIVITY: readonly ActivityEntry[] = [
  { id: "a-1", at: "09:42", message: "Marketplace payout reconciled" },
  { id: "a-2", at: "08:15", message: "Partner tier recalculated" },
  { id: "a-3", at: "07:03", message: "Nightly export completed" },
];

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * An in-memory {@link ReportApi} with per-section latency and failures.
 *
 * Usage:
 *   const api = createInMemoryReportApi({
 *     latencyMs: { summary: 20, breakdown: 400, activity: 60 },
 *     failWhen: (section) => (section === "activity" ? "Feed unavailable" : null),
 *   });
 */
export function createInMemoryReportApi(options: InMemoryReportApiOptions = {}): ReportApi {
  const {
    latencyMs = {},
    failWhen,
    onEvent,
    summary = DEMO_SUMMARY,
    breakdown = DEMO_BREAKDOWN,
    activity = DEMO_ACTIVITY,
  } = options;

  const events: RequestEvent[] = [];

  const record = (event: RequestEvent): void => {
    events.push(event);
    onEvent?.(event);
  };

  async function request<T>(section: ReportSectionName, value: T): Promise<T> {
    record({ kind: "start", section });
    await delay(latencyMs[section] ?? 0);

    const failure = failWhen?.(section);
    // Settle is recorded for a rejection too — a failed request still occupied
    // the window it ran in, and a concurrency claim that ignored failures
    // would be wrong exactly when a section is broken.
    record({ kind: "settle", section });

    if (failure !== null && failure !== undefined) throw new ReportApiError(failure);
    return value;
  }

  return {
    fetchSummary: () => request("summary", summary),
    fetchBreakdown: () => request("breakdown", breakdown),
    fetchActivity: () => request("activity", activity),
    timeline: () => [...events],
  };
}

/**
 * Whether two requests were ever in flight at the same time.
 *
 * This is the precise form of "did these load in parallel", and its negation
 * is a waterfall. Both are statements about overlap, so both are decided by
 * comparing start positions against settle positions:
 *
 *   concurrent  ⇔  start(a) < settle(b)  ∧  start(b) < settle(a)
 *
 * A request that never settled counts as still in flight, so a section still
 * pending when the assertion runs is concurrent with everything started after
 * it. A section that never started is concurrent with nothing.
 *
 * Only the first start of each section is considered; a retry after
 * `invalidate` is a different question and this helper does not answer it.
 */
export function wereConcurrent(
  events: readonly RequestEvent[],
  a: ReportSectionName,
  b: ReportSectionName,
): boolean {
  const indexOf = (kind: RequestEvent["kind"], section: ReportSectionName): number =>
    events.findIndex((event) => event.kind === kind && event.section === section);

  const startA = indexOf("start", a);
  const startB = indexOf("start", b);
  if (startA === -1 || startB === -1) return false;

  const settleIndex = (section: ReportSectionName): number => {
    const found = indexOf("settle", section);
    return found === -1 ? Number.POSITIVE_INFINITY : found;
  };

  return startA < settleIndex(b) && startB < settleIndex(a);
}
