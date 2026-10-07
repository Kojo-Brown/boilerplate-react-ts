import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ErrorReporter } from "@/shared/observability/errorReporter";
import {
  DEFAULT_VIOLATION_LIMIT,
  reportCspViolations,
} from "@/shared/security/reportCspViolations";

/**
 * jsdom has no CSP engine, so nothing here can provoke a real violation. What
 * is being tested is the only part that is ours: the mapping from an event to a
 * report, and the two kinds of throttling that stop a list view from emptying
 * the error budget. The policy itself is proved by a browser in
 * `e2e/csp.spec.ts`.
 */
interface ViolationInit {
  effectiveDirective?: string;
  violatedDirective?: string;
  blockedURI?: string;
  disposition?: string;
  sample?: string;
  sourceFile?: string;
  lineNumber?: number;
  columnNumber?: number;
  originalPolicy?: string;
}

function violation(init: ViolationInit = {}): Event {
  const event = new Event("securitypolicyviolation");
  return Object.assign(event, {
    effectiveDirective: "script-src",
    violatedDirective: "script-src",
    blockedURI: "inline",
    disposition: "enforce",
    sample: "",
    sourceFile: "https://app.test/",
    lineNumber: 12,
    columnNumber: 3,
    originalPolicy: "default-src 'none'",
    ...init,
  });
}

type Capture = ErrorReporter["captureException"];

let captureException: ReturnType<typeof vi.fn<Capture>>;
let target: EventTarget;

beforeEach(() => {
  captureException = vi.fn<Capture>(() => "event-id");
  target = new EventTarget();
});

function subscribe(limit?: number): () => void {
  return reportCspViolations({
    reporter: { captureException },
    target,
    ...(limit === undefined ? {} : { limit }),
  });
}

describe("reportCspViolations", () => {
  it("reports a violation with the directive, the blocked URI and the sample", () => {
    subscribe();
    target.dispatchEvent(violation({ blockedURI: "eval", sample: "new Function('return 1')" }));

    expect(captureException).toHaveBeenCalledTimes(1);
    const [error, hint] = captureException.mock.calls[0]!;
    expect((error as Error).message).toBe("Content-Security-Policy blocked eval");
    expect(error).toBeInstanceOf(Error);
    expect(hint).toMatchObject({
      level: "warning",
      mechanism: { type: "csp.violation", handled: true },
      tags: { cspDirective: "script-src", cspDisposition: "enforce" },
    });
    expect(hint?.contexts).toMatchObject({
      csp: {
        blockedURI: "eval",
        effectiveDirective: "script-src",
        sample: "new Function('return 1')",
        lineNumber: "12",
        columnNumber: "3",
      },
    });
  });

  it("falls back to violatedDirective, which is what Safari still sends", () => {
    subscribe();
    target.dispatchEvent(violation({ effectiveDirective: "", violatedDirective: "img-src" }));

    const [, hint] = captureException.mock.calls[0]!;
    expect(hint?.tags).toMatchObject({ cspDirective: "img-src" });
  });

  it("names the resource generically when the blocked URI is empty", () => {
    subscribe();
    target.dispatchEvent(violation({ blockedURI: "" }));

    const [error] = captureException.mock.calls[0]!;
    expect((error as Error).message).toBe("Content-Security-Policy blocked an inline resource");
  });

  it("reports one event per distinct directive and blocked URI", () => {
    subscribe();
    // A list of a hundred blocked images is one defect, not a hundred.
    for (let i = 0; i < 100; i += 1) {
      target.dispatchEvent(
        violation({ effectiveDirective: "img-src", blockedURI: "https://cdn.test/x.png" }),
      );
    }
    target.dispatchEvent(
      violation({ effectiveDirective: "img-src", blockedURI: "https://cdn.test/y.png" }),
    );
    // Same URI, different directive: a separate defect — `connect-src` refusing
    // something `img-src` also refused means two directives need widening.
    target.dispatchEvent(
      violation({ effectiveDirective: "connect-src", blockedURI: "https://cdn.test/x.png" }),
    );

    expect(captureException).toHaveBeenCalledTimes(3);
  });

  it("stops at the limit, so a loop cannot empty the error budget", () => {
    subscribe(2);
    target.dispatchEvent(violation({ blockedURI: "a" }));
    target.dispatchEvent(violation({ blockedURI: "b" }));
    target.dispatchEvent(violation({ blockedURI: "c" }));

    expect(captureException).toHaveBeenCalledTimes(2);
  });

  it("defaults the limit", () => {
    subscribe();
    for (let i = 0; i < DEFAULT_VIOLATION_LIMIT + 5; i += 1) {
      target.dispatchEvent(violation({ blockedURI: `https://cdn.test/${String(i)}.png` }));
    }
    expect(captureException).toHaveBeenCalledTimes(DEFAULT_VIOLATION_LIMIT);
  });

  it("unsubscribes", () => {
    const stop = subscribe();
    stop();
    target.dispatchEvent(violation());
    expect(captureException).not.toHaveBeenCalled();
  });
});
