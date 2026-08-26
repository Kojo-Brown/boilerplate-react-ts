import { createSectionCache, type SectionCache } from "@/entities/report/sectionCache";
import type { ReportApi, ReportSections } from "@/entities/report/reportApi";

/** The cache type every report component takes. */
export type ReportCache = SectionCache<ReportSections>;

/**
 * Wires a {@link ReportApi} to a section cache.
 *
 * One place decides which loader backs which section, so the page and the
 * tests exercise the same wiring rather than two hand-rolled copies that can
 * drift apart — a test that prefetched a section the page never registers
 * would be measuring nothing.
 *
 * The cache's lifetime is the caller's: it must outlive every render of the
 * components reading it, and replacing it is the only way to refetch the page.
 * Remount the subtree when you replace it.
 */
export function createReportCache(api: ReportApi): ReportCache {
  return createSectionCache<ReportSections>({
    summary: () => api.fetchSummary(),
    breakdown: () => api.fetchBreakdown(),
    activity: () => api.fetchActivity(),
  });
}
