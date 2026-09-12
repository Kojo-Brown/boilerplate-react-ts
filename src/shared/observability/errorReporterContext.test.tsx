import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorReporterProvider } from "@/shared/observability/ErrorReporterProvider";
import { fallbackReporter, useErrorReporter } from "@/shared/observability/errorReporterContext";
import { createMemoryTransport, createReporter } from "@/shared/observability/errorReporter";

function Probe({ onReporter }: { onReporter: (r: ReturnType<typeof useErrorReporter>) => void }) {
  onReporter(useErrorReporter());
  return <p>probe</p>;
}

describe("useErrorReporter", () => {
  it("returns the provided reporter", () => {
    const sink = createMemoryTransport();
    const reporter = createReporter({ transport: sink.transport });
    let seen: unknown = null;

    render(
      <ErrorReporterProvider reporter={reporter}>
        <Probe
          onReporter={(r) => {
            seen = r;
          }}
        />
      </ErrorReporterProvider>,
    );

    expect(seen).toBe(reporter);
  });

  it("works outside a provider instead of throwing", () => {
    /*
     * The opposite of `useApiClient`, deliberately. That hook throws when it
     * has no provider, so a component reaching the network in a test fails
     * loudly. This one is consumed from `componentDidCatch` — while React is
     * already unwinding — where a throw replaces the fallback the user was
     * about to see with a blank page. An unconfigured reporter is a
     * deployment mistake; an error screen that crashes is an outage.
     */
    let seen: ReturnType<typeof useErrorReporter> | null = null;
    render(
      <Probe
        onReporter={(r) => {
          seen = r;
        }}
      />,
    );

    expect(screen.getByText("probe")).toBeInTheDocument();
    expect(seen).toBe(fallbackReporter);
    expect(() => seen?.captureException(new Error("x"))).not.toThrow();
  });

  it("shapes events even with nowhere to send them, so the path is never untested", () => {
    // A real reporter over a discarding transport, not a stub of no-ops: a
    // `captureException` that only breaks in the one build reaching the real
    // reporter is the bug this removes.
    expect(fallbackReporter.captureException(new Error("x"))).toMatch(/^[0-9a-f]{32}$/);
    expect(() => {
      fallbackReporter.addBreadcrumb({ category: "ui.click", level: "info", message: "x" });
      fallbackReporter.setTag("k", "v");
    }).not.toThrow();
  });

  it("lets a nested provider win, for a lab page or a story", () => {
    const outer = createReporter({ transport: () => {} });
    const inner = createReporter({ transport: () => {} });
    let seen: unknown = null;

    render(
      <ErrorReporterProvider reporter={outer}>
        <ErrorReporterProvider reporter={inner}>
          <Probe
            onReporter={(r) => {
              seen = r;
            }}
          />
        </ErrorReporterProvider>
      </ErrorReporterProvider>,
    );

    expect(seen).toBe(inner);
  });
});
