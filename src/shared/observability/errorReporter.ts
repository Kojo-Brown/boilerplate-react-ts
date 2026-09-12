/**
 * The port every error goes through, and the one place that decides what not
 * to send.
 *
 * `ErrorTransport` is the seam. Swapping in a real backend is a one-line
 * change at the composition root, and nothing above this module knows whether
 * there is one — which is what keeps `captureException` callable from a
 * component without that component importing an SDK.
 *
 * The deduplication is not an optimisation, it is a correctness fix for two
 * things React does that are invisible from the call site.
 *
 * **React 19 reports a caught error twice.** `createRoot` accepts
 * `onCaughtError`, and an error boundary still has `componentDidCatch`; for
 * one throw React calls `onCaughtError` *and then* the boundary's
 * `componentDidCatch`, both carrying a component stack. Wiring the reporter
 * into both — which is the natural thing to do, since the root option is
 * advertised as the React 19 way and the boundary already had the lifecycle —
 * doubles every count in the dashboard. `src/app/main.tsx` therefore wires
 * only `onUncaughtError`, and the window is what stops an accidental
 * re-wiring from being a silent factor of two.
 *
 * **A deterministic error is retried by a human.** The fallback offers "Try
 * again", the render throws again, and each attempt is a fresh event with an
 * identical stack. What a dashboard should record there is one issue whose
 * count reflects distinct failures, not how many times someone jabbed a
 * button.
 *
 * The window is a window rather than Sentry's compare-with-previous, because
 * compare-with-previous drops the second of two genuinely different failures
 * that happen to alternate — an A/B/A/B pair reports A once and B never, since
 * each one's predecessor differs. Time-bounding it means a repeated failure
 * seconds apart still reports, which is the signal that a retry loop is
 * underway.
 */

import {
  createEventId,
  fingerprintOf,
  toExceptionChain,
  type ErrorEvent,
  type ErrorLevel,
  type ErrorMechanism,
  type Breadcrumb,
} from "@/shared/observability/errorEvent";
import { createBreadcrumbBuffer, type BreadcrumbBuffer } from "@/shared/observability/breadcrumbs";
import { redactMessage } from "@/shared/observability/redact";

/** Where a shaped event goes. Implementations must never throw. */
export type ErrorTransport = (event: ErrorEvent) => void;

/** Per-capture detail the reporter cannot know on its own. */
export interface CaptureHint {
  level?: ErrorLevel;
  mechanism?: ErrorMechanism;
  /** Merged over the reporter's own tags. */
  tags?: Record<string, string>;
  /** React's component stack, when a boundary or root handler supplied one. */
  componentStack?: string;
  /** Extra structured context, e.g. `{ route: { path } }`. */
  contexts?: Record<string, Record<string, string>>;
}

export interface ErrorReporter {
  /**
   * Reports a thrown value.
   *
   * Returns the event id, or `null` when the event was dropped — by the
   * dedupe window or by `beforeSend`. Callers display the id, so a `null`
   * means "do not show the user a reference that was never sent".
   */
  captureException: (thrown: unknown, hint?: CaptureHint) => string | null;
  /** Records a breadcrumb for whatever fails next. */
  addBreadcrumb: (crumb: Omit<Breadcrumb, "timestamp"> & { timestamp?: number }) => void;
  /** Sets a tag on every subsequent event. */
  setTag: (key: string, value: string) => void;
}

export const DEFAULT_DEDUPE_WINDOW_MS = 1_000;

export interface ReporterOptions {
  transport: ErrorTransport;
  /**
   * Last chance to drop or rewrite an event. Returning `null` drops it.
   * The Sentry hook of the same name, and the place a team's own PII rules go.
   */
  beforeSend?: (event: ErrorEvent) => ErrorEvent | null;
  /** Tags applied to every event, e.g. release and environment. */
  tags?: Record<string, string>;
  breadcrumbs?: BreadcrumbBuffer;
  /** Identical events inside this many ms are dropped. `0` disables dedupe. */
  dedupeWindowMs?: number;
  now?: () => number;
}

/**
 * What two events must share to count as the same.
 *
 * The fingerprint alone is too coarse: it is normalized for *grouping*, so two
 * genuinely separate failures of one kind share it by design. Adding the
 * outermost stack makes the key mean "this same throw, again" rather than
 * "another one of these".
 *
 * Joined on U+001F (unit separator) rather than a character a stack or a
 * message could contain: with a printable delimiter, two events differing only
 * in where the boundary between components fell would collide and one would be
 * silently dropped as a duplicate of the other.
 */
function dedupeKeyOf(event: ErrorEvent): string {
  const outer = event.exception[0];
  return [
    event.fingerprint.join("|"),
    outer?.stack ?? outer?.value ?? "",
    event.mechanism.type,
  ].join("\u001f");
}

export function createReporter(options: ReporterOptions): ErrorReporter {
  const {
    transport,
    beforeSend,
    tags: baseTags = {},
    breadcrumbs = createBreadcrumbBuffer(),
    dedupeWindowMs = DEFAULT_DEDUPE_WINDOW_MS,
    now = Date.now,
  } = options;

  const tags: Record<string, string> = { ...baseTags };
  let lastKey: string | null = null;
  let lastSentAt = 0;

  return {
    addBreadcrumb(crumb) {
      breadcrumbs.add(crumb);
    },

    setTag(key, value) {
      tags[key] = value;
    },

    captureException(thrown, hint = {}) {
      const chain = toExceptionChain(thrown);
      // Redaction happens here rather than at every call site: a message is
      // the field most likely to quote a URL, and the one most likely to be
      // rendered back to the user as well as sent.
      //
      // The stack is redacted too, and forgetting it was a real leak this
      // suite caught: V8 puts the message on the *first line* of `stack`, so
      // an event whose `value` is scrubbed still carries the untouched
      // original one field over. Frames can also carry a query string of their
      // own, a module specifier being a URL.
      const exception = chain.map((entry) => ({
        ...entry,
        value: redactMessage(entry.value),
        ...(entry.stack !== undefined ? { stack: redactMessage(entry.stack) } : {}),
      }));

      const event: ErrorEvent = {
        eventId: createEventId(),
        timestamp: now(),
        level: hint.level ?? "error",
        exception,
        fingerprint: fingerprintOf(exception),
        tags: { ...tags, ...hint.tags },
        contexts: {
          ...hint.contexts,
          ...(hint.componentStack !== undefined
            ? { react: { componentStack: hint.componentStack } }
            : {}),
        },
        breadcrumbs: breadcrumbs.snapshot(),
        mechanism: hint.mechanism ?? { type: "generic", handled: true },
      };

      const key = dedupeKeyOf(event);
      const at = event.timestamp;
      if (dedupeWindowMs > 0 && key === lastKey && at - lastSentAt < dedupeWindowMs) {
        return null;
      }

      const outgoing = beforeSend ? safeBeforeSend(beforeSend, event) : event;
      if (outgoing === null) return null;

      // Recorded only for events that survived, so a dropped event does not
      // start a window that suppresses the next real one.
      lastKey = key;
      lastSentAt = at;

      try {
        transport(outgoing);
      } catch {
        // A reporting failure must never surface as an application error: this
        // runs inside `componentDidCatch`, where a throw takes out the
        // boundary that was showing the user their fallback.
      }
      return outgoing.eventId;
    },
  };
}

/** `beforeSend` is user code on the error path; a throw there must not drop the app. */
function safeBeforeSend(
  beforeSend: (event: ErrorEvent) => ErrorEvent | null,
  event: ErrorEvent,
): ErrorEvent | null {
  try {
    return beforeSend(event);
  } catch {
    // Treated as "no opinion" rather than "drop": a broken hook should not
    // silently disable reporting.
    return event;
  }
}

/** Keeps every event in memory. For tests and the error lab. */
export interface MemoryTransport {
  transport: ErrorTransport;
  readonly events: ErrorEvent[];
}

export function createMemoryTransport(): MemoryTransport {
  const events: ErrorEvent[] = [];
  return {
    events,
    transport(event) {
      events.push(event);
    },
  };
}

/**
 * Logs each event. The transport you want during development.
 *
 * Grouped rather than logged flat, because an event carries a component stack
 * and a breadcrumb trail and the useful line — what broke — would otherwise
 * scroll away above them.
 */
export function createConsoleTransport(
  logger: Pick<Console, "error" | "groupCollapsed" | "groupEnd" | "table"> = console,
): ErrorTransport {
  return (event) => {
    const outer = event.exception[0];
    logger.groupCollapsed(
      `[error] ${outer?.type ?? "Error"}: ${outer?.value ?? ""} (${event.eventId.slice(0, 8)})`,
    );
    logger.error(event);
    if (event.breadcrumbs.length > 0) logger.table(event.breadcrumbs);
    logger.groupEnd();
  };
}

/**
 * Posts events with `sendBeacon`, falling back to `keepalive` fetch.
 *
 * Same transport shape as `shared/analytics/analyticsSink.ts` and for the same
 * reason: an error reported during a navigation away is reported while the
 * document is being torn down, and an ordinary `fetch` started there is
 * cancelled with it. Unbatched, unlike vitals — errors are rare and each one
 * is worth a request, and an error that crashes the tab must not be sitting in
 * a queue when it does.
 */
export function createBeaconTransport(
  endpoint: string,
  send: (url: string, body: string) => boolean = defaultBeacon,
): ErrorTransport {
  return (event) => {
    try {
      send(endpoint, JSON.stringify(event));
    } catch {
      // Nothing to retry into; the page may be going away.
    }
  };
}

const defaultBeacon = (url: string, body: string): boolean => {
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon(url, body)) return true;
  } catch {
    // No `sendBeacon` here (jsdom, old WebViews). Fall through.
  }
  try {
    void fetch(url, { method: "POST", body, keepalive: true }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
};

/** Discards everything. The reporter a build with no endpoint configured gets. */
export const noopTransport: ErrorTransport = () => {};
