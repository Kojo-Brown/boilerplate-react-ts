import { Suspense, use } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { SectionBoundary } from "@/shared/ui/SectionBoundary";
import { createPromiseCache } from "@/shared/lib/promiseCache";
import { actAsync, renderAsync } from "@/test/renderSuspense";

/** Reads a value that may not have arrived, exactly as a real section does. */
function Reader({ read }: { read: () => Promise<string> }) {
  const value = use(read());
  return <p data-testid="value">{value}</p>;
}

let consoleErrorSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("SectionBoundary", () => {
  it("shows the fallback until the data arrives", async () => {
    const cache = createPromiseCache<string, string>({
      load: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return "ready";
      },
    });

    await renderAsync(
      <SectionBoundary name="widget" fallback={<p data-testid="fallback">Loading…</p>}>
        <Reader read={() => cache.read("k")} />
      </SectionBoundary>,
    );

    expect(screen.getByTestId("fallback")).toBeInTheDocument();
    expect(await screen.findByTestId("value")).toHaveTextContent("ready");
    expect(screen.queryByTestId("fallback")).not.toBeInTheDocument();
  });

  it("catches a rejection and names the section it belongs to", async () => {
    const cache = createPromiseCache<string, string>({
      load: () => Promise.reject(new Error("Feed unavailable")),
    });

    await renderAsync(
      <SectionBoundary name="activity" fallback={<p>Loading…</p>}>
        <Reader read={() => cache.read("k")} />
      </SectionBoundary>,
    );

    const error = await screen.findByTestId("section-error");
    expect(error).toHaveAttribute("data-section", "activity");
    expect(error).toHaveTextContent("Could not load activity.");
    expect(error).toHaveTextContent("Feed unavailable");
  });

  it("calls onRetry before resetting, so the reset renders against a fresh request", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    let attempts = 0;
    const cache = createPromiseCache<string, string>({
      load: () => {
        attempts += 1;
        order.push(`load:${String(attempts)}`);
        return attempts === 1 ? Promise.reject(new Error("boom")) : Promise.resolve("recovered");
      },
    });

    await renderAsync(
      <SectionBoundary
        name="widget"
        fallback={<p>Loading…</p>}
        onRetry={() => {
          order.push("invalidate");
          cache.invalidate("k");
        }}
      >
        <Reader read={() => cache.read("k")} />
      </SectionBoundary>,
    );

    await actAsync(() => user.click(screen.getByTestId("retry-section")));

    expect(await screen.findByTestId("value")).toHaveTextContent("recovered");
    // Without the invalidate first, the reset re-reads the same rejected
    // promise and rethrows in the same frame — a button that does nothing.
    expect(order).toEqual(["load:1", "invalidate", "load:2"]);
  });

  it("keeps the error on screen when the retry hits the same failure", async () => {
    const user = userEvent.setup();
    const cache = createPromiseCache<string, string>({
      load: () => Promise.reject(new Error("still down")),
    });

    await renderAsync(
      <SectionBoundary
        name="widget"
        fallback={<p>Loading…</p>}
        onRetry={() => {
          cache.invalidate("k");
        }}
      >
        <Reader read={() => cache.read("k")} />
      </SectionBoundary>,
    );

    const retry = await screen.findByTestId("retry-section");
    await actAsync(() => user.click(retry));

    expect(await screen.findByTestId("section-error")).toHaveTextContent("still down");
  });

  it("puts the error boundary outside the Suspense boundary", async () => {
    // Order is not cosmetic: an error boundary *inside* Suspense is unmounted
    // by the rejection it was meant to catch, and the error escapes to
    // whatever is above. Asserting it from the outside in: a rejection here
    // must not reach the surrounding boundary.
    const cache = createPromiseCache<string, string>({
      load: () => Promise.reject(new Error("inner failure")),
    });

    await renderAsync(
      <Suspense fallback={<p data-testid="outer-fallback">Outer</p>}>
        <SectionBoundary name="widget" fallback={<p>Loading…</p>}>
          <Reader read={() => cache.read("k")} />
        </SectionBoundary>
      </Suspense>,
    );

    expect(await screen.findByTestId("section-error")).toBeInTheDocument();
    expect(screen.queryByTestId("outer-fallback")).not.toBeInTheDocument();
  });

  it("renders without a retry handler", async () => {
    const user = userEvent.setup();
    const cache = createPromiseCache<string, string>({
      load: () => Promise.reject(new Error("boom")),
    });

    await renderAsync(
      <SectionBoundary name="widget" fallback={<p>Loading…</p>}>
        <Reader read={() => cache.read("k")} />
      </SectionBoundary>,
    );

    // The button still resets; it simply re-reads the sticky rejection, which
    // is why `onRetry` exists.
    const retry = await screen.findByTestId("retry-section");
    await actAsync(() => user.click(retry));

    expect(await screen.findByTestId("section-error")).toBeInTheDocument();
  });
});
