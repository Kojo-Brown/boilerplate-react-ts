import type { ReactNode } from "react";
import type { ErrorReporter } from "@/shared/observability/errorReporter";
import { ErrorReporterContext } from "@/shared/observability/errorReporterContext";

export interface ErrorReporterProviderProps {
  reporter: ErrorReporter;
  children: ReactNode;
}

/**
 * Publishes an {@link ErrorReporter} to the subtree.
 *
 * The reporter is constructed by the caller for the same reason
 * `ApiClientProvider` takes its client: identity has to be stable. This one
 * additionally holds mutable state that a rebuild would silently discard — the
 * breadcrumb ring and the dedupe window — so a provider that built its own
 * would lose every crumb on each render and turn deduplication off by
 * forgetting what it last sent.
 */
export function ErrorReporterProvider({ reporter, children }: ErrorReporterProviderProps) {
  return <ErrorReporterContext value={reporter}>{children}</ErrorReporterContext>;
}
