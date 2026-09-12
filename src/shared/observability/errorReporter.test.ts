import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DEFAULT_DEDUPE_WINDOW_MS,
  createBeaconTransport,
  createConsoleTransport,
  createMemoryTransport,
  createReporter,
  noopTransport,
} from "@/shared/observability/errorReporter";
import { createBreadcrumbBuffer } from "@/shared/observability/breadcrumbs";
import type { ErrorEvent } from "@/shared/observability/errorEvent";

/** A minimal shaped event, for tests that exercise a transport directly. */
const baseEvent: ErrorEvent = {
  eventId: "a".repeat(32),
  timestamp: 0,
  level: "error",
  exception: [{ type: "Error", value: "boom" }],
  fingerprint: ["Error", "boom"],
  tags: {},
  contexts: {},
  breadcrumbs: [],
  mechanism: { type: "generic", handled: true },
};

function clock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

describe("createReporter", () => {
  it("shapes an event with an id, a fingerprint and the default mechanism", () => {
    const sink = createMemoryTransport();
    const reporter = createReporter({ transport: sink.transport });

    const eventId = reporter.captureException(new Error("boom"));

    expect(eventId).toMatch(/^[0-9a-f]{32}$/);
    const event = sink.events[0];
    expect(event?.eventId).toBe(eventId);
    expect(event?.level).toBe("error");
    expect(event?.exception[0]).toMatchObject({ type: "Error", value: "boom" });
    expect(event?.fingerprint).toEqual(["Error", "boom"]);
    expect(event?.mechanism).toEqual({ type: "generic", handled: true });
  });

  it("merges reporter tags with per-capture tags, the capture winning", () => {
    const sink = createMemoryTransport();
    const reporter = createReporter({
      transport: sink.transport,
      tags: { environment: "production", release: "abc123" },
    });
    reporter.setTag("userTier", "pro");

    reporter.captureException(new Error("x"), { tags: { environment: "staging", route: "/x" } });

    expect(sink.events[0]?.tags).toEqual({
      environment: "staging",
      release: "abc123",
      userTier: "pro",
      route: "/x",
    });
  });

  it("attaches the component stack under contexts.react", () => {
    const sink = createMemoryTransport();
    const reporter = createReporter({ transport: sink.transport });

    reporter.captureException(new Error("x"), { componentStack: "\n at Dashboard" });

    expect(sink.events[0]?.contexts.react).toEqual({ componentStack: "\n at Dashboard" });
  });

  it("omits contexts.react when no stack was supplied", () => {
    const sink = createMemoryTransport();
    createReporter({ transport: sink.transport }).captureException(new Error("x"));
    expect(sink.events[0]?.contexts.react).toBeUndefined();
  });

  it("attaches the breadcrumb trail collected so far", () => {
    const sink = createMemoryTransport();
    const reporter = createReporter({
      transport: sink.transport,
      breadcrumbs: createBreadcrumbBuffer({ now: () => 1 }),
    });

    reporter.addBreadcrumb({ category: "navigation", level: "info", message: "/ → /dashboard" });
    reporter.addBreadcrumb({ category: "ui.click", level: "info", message: "button: Refresh" });
    reporter.captureException(new Error("x"));

    expect(sink.events[0]?.breadcrumbs.map((c) => c.message)).toEqual([
      "/ → /dashboard",
      "button: Refresh",
    ]);
  });

  it("redacts a credential quoted in the error message", () => {
    const sink = createMemoryTransport();
    createReporter({ transport: sink.transport }).captureException(
      new Error("Failed to fetch https://api.test/me?access_token=sk-live-1"),
    );
    expect(JSON.stringify(sink.events[0])).not.toContain("sk-live-1");
  });

  it("records the whole cause chain", () => {
    const sink = createMemoryTransport();
    const root = new Error("ECONNREFUSED");
    createReporter({ transport: sink.transport }).captureException(
      new Error("could not load dashboard", { cause: root }),
    );
    expect(sink.events[0]?.exception.map((e) => e.value)).toEqual([
      "could not load dashboard",
      "ECONNREFUSED",
    ]);
  });
});

describe("deduplication", () => {
  it("drops an identical event inside the window and returns null", () => {
    const sink = createMemoryTransport();
    const time = clock();
    const reporter = createReporter({ transport: sink.transport, now: time.now });
    const error = new Error("same");

    expect(reporter.captureException(error)).not.toBeNull();
    expect(reporter.captureException(error)).toBeNull();
    expect(sink.events).toHaveLength(1);
  });

  it("reports again once the window has passed, so a retry loop stays visible", () => {
    const sink = createMemoryTransport();
    const time = clock();
    const reporter = createReporter({ transport: sink.transport, now: time.now });
    const error = new Error("same");

    reporter.captureException(error);
    time.advance(DEFAULT_DEDUPE_WINDOW_MS + 1);
    reporter.captureException(error);

    expect(sink.events).toHaveLength(2);
  });

  it("does not conflate two different errors reported back to back", () => {
    const sink = createMemoryTransport();
    const reporter = createReporter({ transport: sink.transport, now: clock().now });

    reporter.captureException(new Error("first"));
    reporter.captureException(new Error("second"));

    expect(sink.events).toHaveLength(2);
  });

  it("keeps both sides of an alternating A/B/A/B pair", () => {
    // The reason the window is a window rather than Sentry's
    // compare-with-previous: under that rule each event's predecessor differs,
    // so B is dropped every time and never reported at all.
    const sink = createMemoryTransport();
    const reporter = createReporter({ transport: sink.transport, now: clock().now });
    const a = new Error("A");
    const b = new Error("B");

    reporter.captureException(a);
    reporter.captureException(b);
    reporter.captureException(a);
    reporter.captureException(b);

    expect(sink.events.map((e) => e.exception[0]?.value)).toEqual(["A", "B", "A", "B"]);
  });

  it("separates the same error reported through different mechanisms", () => {
    const sink = createMemoryTransport();
    const reporter = createReporter({ transport: sink.transport, now: clock().now });
    const error = new Error("same");

    reporter.captureException(error, { mechanism: { type: "route-boundary", handled: true } });
    reporter.captureException(error, { mechanism: { type: "window.onerror", handled: false } });

    expect(sink.events).toHaveLength(2);
  });

  it("can be switched off with a zero window", () => {
    const sink = createMemoryTransport();
    const reporter = createReporter({
      transport: sink.transport,
      dedupeWindowMs: 0,
      now: clock().now,
    });
    const error = new Error("same");

    reporter.captureException(error);
    reporter.captureException(error);

    expect(sink.events).toHaveLength(2);
  });

  it("does not let a dropped event start a window that suppresses the next real one", () => {
    const sink = createMemoryTransport();
    const time = clock();
    const reporter = createReporter({
      transport: sink.transport,
      now: time.now,
      beforeSend: (event) => (event.exception[0]?.value === "filtered" ? null : event),
    });

    reporter.captureException(new Error("filtered"));
    reporter.captureException(new Error("real"));

    expect(sink.events.map((e) => e.exception[0]?.value)).toEqual(["real"]);
  });
});

describe("beforeSend", () => {
  it("can drop an event", () => {
    const sink = createMemoryTransport();
    const reporter = createReporter({ transport: sink.transport, beforeSend: () => null });
    expect(reporter.captureException(new Error("x"))).toBeNull();
    expect(sink.events).toHaveLength(0);
  });

  it("can rewrite an event, and the returned id is the rewritten one", () => {
    const sink = createMemoryTransport();
    const reporter = createReporter({
      transport: sink.transport,
      beforeSend: (event): ErrorEvent => ({ ...event, eventId: "f".repeat(32) }),
    });
    expect(reporter.captureException(new Error("x"))).toBe("f".repeat(32));
    expect(sink.events[0]?.eventId).toBe("f".repeat(32));
  });

  it("treats a throwing hook as no opinion rather than silently disabling reporting", () => {
    const sink = createMemoryTransport();
    const reporter = createReporter({
      transport: sink.transport,
      beforeSend: () => {
        throw new Error("hook is broken");
      },
    });
    expect(reporter.captureException(new Error("x"))).not.toBeNull();
    expect(sink.events).toHaveLength(1);
  });
});

describe("failure containment", () => {
  it("never lets a transport failure escape — it runs inside componentDidCatch", () => {
    const reporter = createReporter({
      transport: () => {
        throw new Error("collector is down");
      },
    });
    expect(() => reporter.captureException(new Error("x"))).not.toThrow();
  });

  it("still returns an event id when the transport threw", () => {
    const reporter = createReporter({
      transport: () => {
        throw new Error("collector is down");
      },
    });
    expect(reporter.captureException(new Error("x"))).toMatch(/^[0-9a-f]{32}$/);
  });

  it("reports a thrown non-Error rather than crashing on .message", () => {
    const sink = createMemoryTransport();
    const reporter = createReporter({ transport: sink.transport });
    expect(() => reporter.captureException("just a string")).not.toThrow();
    expect(sink.events[0]?.exception[0]?.value).toBe("just a string");
  });
});

describe("transports", () => {
  it("noopTransport discards", () => {
    expect(() => {
      noopTransport({} as ErrorEvent);
    }).not.toThrow();
  });

  it("createConsoleTransport groups the event with its breadcrumbs", () => {
    const logger = {
      error: vi.fn(),
      groupCollapsed: vi.fn(),
      groupEnd: vi.fn(),
      table: vi.fn(),
    };
    const reporter = createReporter({ transport: createConsoleTransport(logger) });
    reporter.addBreadcrumb({ category: "ui.click", level: "info", message: "button: Go" });
    reporter.captureException(new TypeError("boom"));

    expect(logger.groupCollapsed).toHaveBeenCalledWith(expect.stringContaining("TypeError: boom"));
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.table).toHaveBeenCalledOnce();
    expect(logger.groupEnd).toHaveBeenCalledOnce();
  });

  it("createConsoleTransport skips the table when there are no breadcrumbs", () => {
    const logger = {
      error: vi.fn(),
      groupCollapsed: vi.fn(),
      groupEnd: vi.fn(),
      table: vi.fn(),
    };
    createReporter({ transport: createConsoleTransport(logger) }).captureException(new Error("x"));
    expect(logger.table).not.toHaveBeenCalled();
  });

  it("createBeaconTransport posts one serialised event per error", () => {
    const send = vi.fn(() => true);
    const sink = createBeaconTransport("/errors", send);
    createReporter({ transport: sink }).captureException(new Error("boom"));

    expect(send).toHaveBeenCalledOnce();
    const [url, body] = send.mock.calls[0] as unknown as [string, string];
    expect(url).toBe("/errors");
    expect((JSON.parse(body) as ErrorEvent).exception[0]?.value).toBe("boom");
  });

  it("createBeaconTransport swallows a send that throws during page teardown", () => {
    const sink = createBeaconTransport("/errors", () => {
      throw new Error("document is going away");
    });
    expect(() => {
      createReporter({ transport: sink }).captureException(new Error("boom"));
    }).not.toThrow();
  });
});

describe("the default beacon", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers navigator.sendBeacon", () => {
    const sendBeacon = vi.fn(() => true);
    const fetchSpy = vi.fn();
    vi.stubGlobal("navigator", { sendBeacon });
    vi.stubGlobal("fetch", fetchSpy);

    createBeaconTransport("/errors")({ ...baseEvent });

    expect(sendBeacon).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to a keepalive fetch when the beacon is refused", () => {
    // `sendBeacon` returns false when the payload exceeds the user-agent's
    // queue limit, which is a rejection rather than an error.
    vi.stubGlobal("navigator", { sendBeacon: () => false });
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(null)));
    vi.stubGlobal("fetch", fetchSpy);

    createBeaconTransport("/errors")({ ...baseEvent });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    // What lets the request outlive a document that is being torn down.
    expect(init.keepalive).toBe(true);
    expect(init.method).toBe("POST");
  });

  it("falls back to fetch where there is no sendBeacon at all", () => {
    vi.stubGlobal("navigator", {
      sendBeacon: () => {
        throw new TypeError("not a function");
      },
    });
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(null)));
    vi.stubGlobal("fetch", fetchSpy);

    createBeaconTransport("/errors")({ ...baseEvent });

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("gives up quietly when neither transport exists", () => {
    vi.stubGlobal("navigator", undefined);
    vi.stubGlobal("fetch", () => {
      throw new TypeError("no fetch here either");
    });

    expect(() => {
      createBeaconTransport("/errors")({ ...baseEvent });
    }).not.toThrow();
  });

  it("swallows a rejected keepalive fetch rather than an unhandled rejection", async () => {
    vi.stubGlobal("navigator", { sendBeacon: () => false });
    vi.stubGlobal("fetch", () => Promise.reject(new Error("network down")));

    createBeaconTransport("/errors")({ ...baseEvent });
    await Promise.resolve();
    // Reaching here without an unhandled rejection is the assertion.
    expect(true).toBe(true);
  });
});
