import type { BoundaryLayout, LoadingStrategy } from "@/widgets/streaming-report/StreamingReport";
import { REPORT_SECTIONS, type ReportSectionName } from "@/entities/report/reportApi";

/** Which section `/labs/streaming` breaks, or `none` for a healthy service. */
export type FailingSection = ReportSectionName | "none";

/** Base latency used when `?latency=` is missing or unusable. */
export const DEFAULT_REPORT_LATENCY_MS = 1_200;

/**
 * Upper bound on `?latency=`. Long enough to watch each reveal land
 * separately, short enough that the page still behaves like a demo.
 */
export const MAX_REPORT_LATENCY_MS = 8_000;

/** Message the broken section rejects with. */
export const REPORT_FAILURE_MESSAGE = "The reporting service is unavailable.";

/** Anything other than an explicit `flat` uses nested boundaries. */
export function parseBoundaryLayout(raw: string | null): BoundaryLayout {
  return raw === "flat" ? "flat" : "nested";
}

/** Anything other than an explicit `waterfall` prefetches. */
export function parseLoadingStrategy(raw: string | null): LoadingStrategy {
  return raw === "waterfall" ? "waterfall" : "parallel";
}

/** Parses `?fail=`, ignoring anything that is not a real section name. */
export function parseFailingSection(raw: string | null): FailingSection {
  const match = REPORT_SECTIONS.find((section) => section === raw);
  return match ?? "none";
}

/** Parses `?latency=`, falling back to the default and clamping to the maximum. */
export function parseReportLatency(raw: string | null): number {
  const parsed = Number(raw);
  if (raw === null || raw.trim() === "" || !Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_REPORT_LATENCY_MS;
  }
  return Math.min(MAX_REPORT_LATENCY_MS, Math.floor(parsed));
}

/**
 * Per-section latencies, derived from one base so the *shape* is fixed while
 * the overall speed is adjustable.
 *
 * The proportions carry the demonstration and so are not free parameters: the
 * summary has to be quick enough that the shell arrives well before the
 * sections (otherwise nested and flat look identical), and the activity feed
 * has to settle before the breakdown so reveal order visibly disagrees with
 * source order.
 */
export function reportLatencies(baseMs: number): Record<ReportSectionName, number> {
  return {
    summary: Math.round(baseMs * 0.3),
    breakdown: baseMs,
    activity: Math.round(baseMs * 0.55),
  };
}
