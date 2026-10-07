import type { ErrorReporter } from "@/shared/observability/errorReporter";

/**
 * Turns Content-Security-Policy violations into reported events.
 *
 * A policy you cannot observe is a policy you cannot tighten. `docs/csp.md`
 * sets out what this application is allowed to load, and the only honest way
 * to keep that list honest is to find out when a browser refuses something —
 * because every refusal is one of exactly two things, and both of them need a
 * person: a feature that quietly does not work, or an injection attempt
 * arriving as a blocked inline script.
 *
 * ### What this cannot see, and why it exists anyway
 *
 * `securitypolicyviolation` is a DOM event, so a listener can only hear
 * violations that happen after it is attached. The ones it structurally cannot
 * hear are the ones in the initial document: if the nonce substitution failed,
 * the entry script is refused before any of this code exists to notice. That
 * class is covered instead by `e2e/csp.spec.ts`, which subscribes before the
 * page's own scripts run, and completely by a `report-to` endpoint, which this
 * application does not have — see the gaps in `docs/csp.md`.
 *
 * What is left is the large and interesting remainder: everything a *route*
 * does. A lazily loaded page that reaches for a new origin, a third-party
 * widget somebody adds, a style element a library injects — each shows up here
 * on the visit that triggers it rather than in a bug report three weeks later
 * describing a blank panel.
 */

/** Max distinct violations reported per page load. */
export const DEFAULT_VIOLATION_LIMIT = 10;

export interface CspViolationReportOptions {
  readonly reporter: Pick<ErrorReporter, "captureException">;
  /** Injected so a test does not need a real document. */
  readonly target?: EventTarget;
  /** Max distinct violations per page load. Defaults to {@link DEFAULT_VIOLATION_LIMIT}. */
  readonly limit?: number;
}

/**
 * Subscribes, and returns the unsubscribe.
 *
 * Two kinds of throttling, because a CSP violation is the one error that
 * arrives in bulk by construction. A page rendering a hundred blocked images
 * raises a hundred identical events, so **distinct** violations are counted
 * rather than events: the key is the directive plus the blocked URI, which is
 * what a person would deduplicate by anyway. And the count is capped, because
 * the pathological case is not a hundred but a list view that renders one per
 * row and keeps scrolling. The reporter's own dedupe window is not enough on
 * its own: it is a one-second window, and these arrive over the lifetime of a
 * visit.
 */
export function reportCspViolations(options: CspViolationReportOptions): () => void {
  const { reporter, target = document, limit = DEFAULT_VIOLATION_LIMIT } = options;
  const seen = new Set<string>();

  const listener = (event: Event): void => {
    const violation = event as SecurityPolicyViolationEvent;
    const directive = violation.effectiveDirective || violation.violatedDirective;
    const key = `${directive}\u001f${violation.blockedURI}`;
    if (seen.has(key)) return;
    if (seen.size >= limit) return;
    seen.add(key);

    reporter.captureException(
      new Error(`Content-Security-Policy blocked ${violation.blockedURI || "an inline resource"}`),
      {
        /*
          `warning`, not `error`. A violation is a defect — in the policy or in
          the code — but the page is still up and the user is still working,
          and the one thing that must not happen to this channel is that it
          starts paging people. The disposition tag is what makes a
          report-only policy's noise separable from a real block.
        */
        level: "warning",
        mechanism: { type: "csp.violation", handled: true },
        tags: { cspDirective: directive, cspDisposition: violation.disposition },
        contexts: {
          csp: {
            blockedURI: violation.blockedURI,
            effectiveDirective: directive,
            originalPolicy: violation.originalPolicy,
            /*
              Up to 40 characters of whatever was refused, which the spec caps
              and this does not extend. It is the single most useful field —
              and on the day it matters it contains an attacker's payload, so
              it is stored as text and never rendered as markup. The same rule
              the rest of the codebase applies to anything from the network.
            */
            sample: violation.sample,
            sourceFile: violation.sourceFile,
            // Stringified because `contexts` is `Record<string, string>`: the
            // transport is a beacon and a number that arrives as a string is
            // better than a context that cannot carry it.
            lineNumber: String(violation.lineNumber),
            columnNumber: String(violation.columnNumber),
          },
        },
      },
    );
  };

  target.addEventListener("securitypolicyviolation", listener);
  return () => {
    target.removeEventListener("securitypolicyviolation", listener);
  };
}
