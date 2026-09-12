/**
 * Why the composition root wires `onUncaughtError` and not `onCaughtError`.
 *
 * These tests exist to pin a behaviour of React itself, not of this code. The
 * comment in `src/app/main.tsx` asserts that React 19 calls a root's
 * `onCaughtError` *and* the catching boundary's `componentDidCatch` for one
 * error, so wiring the reporter into both doubles every count. That claim
 * is only worth the comment if something fails when it stops being true —
 * a React upgrade that unified the two would otherwise silently turn the
 * boundary's report into no report at all.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { Component, act, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryTransport, createReporter } from "@/shared/observability/errorReporter";

let consoleErrorSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  // React logs every caught error; the suite asserts on the reporter instead.
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

function Boom(): ReactNode {
  throw new Error("boom");
}

class Boundary extends Component<
  { children: ReactNode; onError: (error: Error, info: ErrorInfo) => void },
  { error: Error | null }
> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError(error, info);
  }
  override render(): ReactNode {
    return this.state.error === null ? this.props.children : <p>caught</p>;
  }
}

/**
 * Renders into a root of its own so the root-level handlers can be set.
 *
 * Synchronous: every throw here happens during render, so the sync form of
 * `act` flushes all of it, and an `async` wrapper would be awaiting a `void`.
 */
function renderWithRoot(ui: ReactNode, rootOptions: Parameters<typeof createRoot>[1]): () => void {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host, rootOptions);
  act(() => {
    root.render(ui);
  });
  return () => {
    act(() => {
      root.unmount();
    });
    host.remove();
  };
}

describe("React 19 caught-error hooks", () => {
  it("fires onCaughtError AND componentDidCatch for a single throw", () => {
    const order: string[] = [];
    const cleanup = renderWithRoot(
      <Boundary
        onError={() => {
          order.push("componentDidCatch");
        }}
      >
        <Boom />
      </Boundary>,
      {
        onCaughtError: () => {
          order.push("onCaughtError");
        },
      },
    );

    // Both, and in this order: the root handler runs first, which is why
    // "let the first report win" would discard the boundary's richer one.
    expect(order).toEqual(["onCaughtError", "componentDidCatch"]);
    cleanup();
  });

  it("wiring the reporter into both would double every count", () => {
    const sink = createMemoryTransport();
    // Dedupe off, to measure how many times React asks rather than how many
    // survive the window.
    const reporter = createReporter({ transport: sink.transport, dedupeWindowMs: 0 });

    const cleanup = renderWithRoot(
      <Boundary
        onError={(error, info) => {
          reporter.captureException(error, {
            mechanism: { type: "route-boundary", handled: true },
            ...(info.componentStack != null ? { componentStack: info.componentStack } : {}),
          });
        }}
      >
        <Boom />
      </Boundary>,
      {
        onCaughtError: (error) => {
          reporter.captureException(error, {
            mechanism: { type: "react.onCaughtError", handled: true },
          });
        },
      },
    );

    expect(sink.events).toHaveLength(2);
    cleanup();
  });

  it("the boundary alone reports once, with the component stack the root lacks", () => {
    const sink = createMemoryTransport();
    const reporter = createReporter({ transport: sink.transport, dedupeWindowMs: 0 });

    // The application's wiring: `onCaughtError` is deliberately absent.
    const cleanup = renderWithRoot(
      <Boundary
        onError={(error, info) => {
          reporter.captureException(error, {
            tags: { route: "/dashboard" },
            mechanism: { type: "route-boundary", handled: true },
            ...(info.componentStack != null ? { componentStack: info.componentStack } : {}),
          });
        }}
      >
        <Boom />
      </Boundary>,
      {
        onUncaughtError: () => {
          reporter.captureException(new Error("should not run"), {
            mechanism: { type: "react.onUncaughtError", handled: false },
          });
        },
      },
    );

    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]?.tags["route"]).toBe("/dashboard");
    expect(sink.events[0]?.contexts.react?.componentStack).toContain("Boom");
    cleanup();
  });

  it("onUncaughtError is what catches a throw no boundary handled", async () => {
    const sink = createMemoryTransport();
    const reporter = createReporter({ transport: sink.transport });

    /*
     * Rendered outside `act()`, which is the only way to reach this path.
     *
     * `act` intercepts an error no boundary caught and rethrows it at the
     * caller so a test cannot pass while the tree is broken — and in doing so
     * it takes the error *instead of* handing it to `onUncaughtError`, which
     * is then never called. Wrapping this in `act` therefore asserts nothing
     * about the handler: it would fail for the throw and leave the hook
     * untested. Rendering bare and waiting for the scheduler reaches it, at
     * the cost of an explicit flush.
     */
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host, {
      onUncaughtError: (error: unknown, info) => {
        reporter.captureException(error, {
          level: "fatal",
          mechanism: { type: "react.onUncaughtError", handled: false },
          ...(info.componentStack != null ? { componentStack: info.componentStack } : {}),
        });
      },
    });
    root.render(<Boom />);
    await vi.waitFor(() => {
      expect(sink.events).toHaveLength(1);
    });

    expect(sink.events[0]?.level).toBe("fatal");
    expect(sink.events[0]?.mechanism.handled).toBe(false);
    expect(sink.events[0]?.contexts.react?.componentStack).toContain("Boom");

    root.unmount();
    host.remove();
  });

  it("the dedupe window absorbs an accidental double wiring", () => {
    const sink = createMemoryTransport();
    // The application's default window, i.e. what actually ships.
    const reporter = createReporter({ transport: sink.transport });

    // `unknown`, because that is how `onCaughtError` types its argument and the
    // reporter accepts anything that can be thrown anyway.
    const capture = (error: unknown, type: string): void => {
      reporter.captureException(error, { mechanism: { type, handled: true } });
    };

    const cleanup = renderWithRoot(
      <Boundary
        onError={(error) => {
          capture(error, "route-boundary");
        }}
      >
        <Boom />
      </Boundary>,
      {
        onCaughtError: (error) => {
          capture(error, "route-boundary");
        },
      },
    );

    // Same mechanism on both paths, so the dedupe key matches and the window
    // collapses them. It is a safety net, not the fix: the two call sites in
    // the test above tag differently and so survive it.
    expect(sink.events).toHaveLength(1);
    cleanup();
  });
});
