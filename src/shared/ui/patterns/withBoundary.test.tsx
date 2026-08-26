import { use } from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { withBoundary } from "@/shared/ui/patterns/withBoundary";
import { SectionBoundary } from "@/shared/ui/SectionBoundary";
import { ErrorBoundary } from "@/shared/ui/ErrorBoundary";
import { createPromiseCache } from "@/shared/lib/promiseCache";
import { renderAsync } from "@/test/renderSuspense";

let consoleErrorSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

interface PanelProps {
  title: string;
  shouldThrow?: boolean;
}

function Panel({ title, shouldThrow = false }: PanelProps) {
  if (shouldThrow) throw new Error("panel exploded");
  return <p data-testid="panel">{title}</p>;
}
Panel.sectionName = "panel";

describe("withBoundary", () => {
  it("renders the wrapped component and passes its props through", () => {
    const Guarded = withBoundary(Panel, { name: "panel", fallback: <p>Loading…</p> });
    render(<Guarded title="Revenue" />);

    expect(screen.getByTestId("panel")).toHaveTextContent("Revenue");
  });

  it("names the wrapper and hoists statics like any other HOC", () => {
    const Guarded = withBoundary(Panel, { name: "panel", fallback: <p>Loading…</p> });

    expect(Guarded.displayName).toBe("withBoundary(Panel)");
    expect(Guarded.sectionName).toBe("panel");
  });

  it("catches an error thrown by the wrapped component itself", () => {
    /*
     * The claim the doc makes about this HOC, stated as a test: the boundary
     * catches the component it wraps, not merely that component's children.
     * Wrapping is what buys that, and wrapping is something only an outer
     * component can do.
     */
    const Guarded = withBoundary(Panel, { name: "panel", fallback: <p>Loading…</p> });
    render(<Guarded title="Revenue" shouldThrow />);

    expect(screen.getByTestId("section-error")).toHaveTextContent("panel exploded");
    expect(screen.queryByTestId("panel")).not.toBeInTheDocument();
  });

  it("does not catch when the boundary is inside the component that throws", () => {
    /*
     * The contrast that makes the HOC the mechanism rather than a convenience,
     * and the reason there is no `useBoundary()` next to it.
     *
     * `SelfGuarded` renders exactly the same boundary — same component, same
     * props — from inside itself, which is the most a hook could ever do,
     * since a hook runs in the body of the component that calls it. It throws
     * before returning, so the boundary it was going to render never exists.
     * The error goes to whatever is above `SelfGuarded` instead: here, the
     * test's own `ErrorBoundary`, standing in for whatever unlucky ancestor
     * would have caught it in an application.
     *
     * This is not a timing quirk that a cleverer hook could route around.
     * Catching means being on the stack above the throw, and nothing a
     * component runs on its own behalf is.
     */
    function SelfGuarded(): React.ReactElement {
      throw new Error("panel exploded");
      // Unreachable, and that is the contrast the test is drawing: the
      // boundary this component was going to render never exists.
      return (
        <SectionBoundary name="panel" fallback={<p>Loading…</p>}>
          <p data-testid="panel">Revenue</p>
        </SectionBoundary>
      );
    }

    render(
      <ErrorBoundary fallback={({ error }) => <p data-testid="outer-error">{error.message}</p>}>
        <SelfGuarded />
      </ErrorBoundary>,
    );

    // The inner boundary caught nothing: it was never rendered.
    expect(screen.queryByTestId("section-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("outer-error")).toHaveTextContent("panel exploded");
  });

  it("shows the fallback while the wrapped component suspends", async () => {
    const cache = createPromiseCache<string, string>({
      load: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return "Revenue";
      },
    });

    function AsyncPanel() {
      const title = use(cache.read("panel"));
      return <p data-testid="panel">{title}</p>;
    }

    const Guarded = withBoundary(AsyncPanel, {
      name: "panel",
      fallback: <p data-testid="fallback">Loading…</p>,
    });

    await renderAsync(<Guarded />);

    expect(screen.getByTestId("fallback")).toBeInTheDocument();
    expect(await screen.findByTestId("panel")).toHaveTextContent("Revenue");
  });

  it("contains the blast radius to the component it wrapped", () => {
    const Guarded = withBoundary(Panel, { name: "panel", fallback: <p>Loading…</p> });

    render(
      <>
        <Guarded title="Revenue" shouldThrow />
        <p data-testid="sibling">Still here</p>
      </>,
    );

    expect(screen.getByTestId("section-error")).toBeInTheDocument();
    expect(screen.getByTestId("sibling")).toBeInTheDocument();
  });
});
