import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { useState } from "react";
import { ErrorBoundary, ErrorFallback } from "@/shared/ui/ErrorBoundary";

// `ReturnType<typeof vi.spyOn>` resolves to an `any`-typed generic instantiation,
// which then poisons every call on the spy.
let consoleErrorSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("Test error message");
  return <div>Child content</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when no error occurs", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("shows default fallback when a child throws", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Test error message")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("calls custom fallback with error and reset when provided", () => {
    const customFallback = vi.fn(({ error }: { error: Error; reset: () => void }) => (
      <div>Custom: {error.message}</div>
    ));
    render(
      <ErrorBoundary fallback={customFallback}>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(customFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: "Test error message" }),
        reset: expect.any(Function),
      }),
    );
    expect(screen.getByText("Custom: Test error message")).toBeInTheDocument();
  });

  it("resets and re-renders children after retry", () => {
    let shouldThrow = true;

    function DynamicChild() {
      if (shouldThrow) throw new Error("boom");
      return <div>Recovered</div>;
    }

    render(
      <ErrorBoundary>
        <DynamicChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByText("Recovered")).toBeInTheDocument();
  });
});

describe("ErrorFallback", () => {
  it("displays the error message", () => {
    render(<ErrorFallback error={new Error("Custom error")} reset={vi.fn()} />);
    expect(screen.getByText("Custom error")).toBeInTheDocument();
  });

  it("calls reset when Try again is clicked", () => {
    const mockReset = vi.fn();
    render(<ErrorFallback error={new Error("error")} reset={mockReset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mockReset).toHaveBeenCalledOnce();
  });

  it("has accessible alert role", () => {
    render(<ErrorFallback error={new Error("error")} reset={vi.fn()} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("ErrorBoundary resetKeys", () => {
  function Harness({
    resetKeys,
    shouldThrow,
    onReset,
  }: {
    resetKeys: readonly unknown[];
    shouldThrow: boolean;
    onReset?: (reason: "keys" | "imperative") => void;
  }) {
    return (
      <ErrorBoundary resetKeys={resetKeys} {...(onReset ? { onReset } : {})}>
        <ThrowingChild shouldThrow={shouldThrow} />
      </ErrorBoundary>
    );
  }

  it("keeps showing the fallback while the keys are unchanged", () => {
    const { rerender } = render(<Harness resetKeys={["a"]} shouldThrow />);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // A new array each render, same contents: an identity comparison would
    // clear the error here.
    rerender(<Harness resetKeys={["a"]} shouldThrow={false} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("clears the error when a key changes", () => {
    const { rerender } = render(<Harness resetKeys={["a"]} shouldThrow />);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(<Harness resetKeys={["b"]} shouldThrow={false} />);
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("treats a changed key length as a change", () => {
    const { rerender } = render(<Harness resetKeys={["a"]} shouldThrow />);
    rerender(<Harness resetKeys={["a", "b"]} shouldThrow={false} />);
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("compares with Object.is, so NaN does not count as a change", () => {
    const { rerender } = render(<Harness resetKeys={[Number.NaN]} shouldThrow />);
    rerender(<Harness resetKeys={[Number.NaN]} shouldThrow={false} />);
    // `NaN === NaN` is false; `Object.is(NaN, NaN)` is true. Under `===` this
    // boundary would reset on every render and never show a fallback at all.
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("does not render the fallback for a frame when the keys change", () => {
    // The reason the comparison lives in `getDerivedStateFromProps` rather
    // than `componentDidUpdate`: the latter clears the error one commit later,
    // so the navigation meant to resolve it paints the old fallback first.
    const seen: string[] = [];
    function Watcher() {
      seen.push("children");
      return <div>Child content</div>;
    }
    function KeyedHarness({
      resetKeys,
      shouldThrow,
    }: {
      resetKeys: readonly unknown[];
      shouldThrow: boolean;
    }) {
      return (
        <ErrorBoundary
          resetKeys={resetKeys}
          fallback={() => {
            seen.push("fallback");
            return <p>fallback</p>;
          }}
        >
          {shouldThrow ? <ThrowingChild shouldThrow /> : <Watcher />}
        </ErrorBoundary>
      );
    }

    const { rerender } = render(<KeyedHarness resetKeys={["a"]} shouldThrow />);
    seen.length = 0;
    rerender(<KeyedHarness resetKeys={["b"]} shouldThrow={false} />);

    expect(seen).toEqual(["children"]);
  });

  it("survives a key change while there is no error", () => {
    const { rerender } = render(<Harness resetKeys={["a"]} shouldThrow={false} />);
    rerender(<Harness resetKeys={["b"]} shouldThrow={false} />);
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("catches again after a key-driven reset", () => {
    const { rerender } = render(<Harness resetKeys={["a"]} shouldThrow />);
    rerender(<Harness resetKeys={["b"]} shouldThrow={false} />);
    expect(screen.getByText("Child content")).toBeInTheDocument();

    rerender(<Harness resetKeys={["c"]} shouldThrow />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("reports why it reset", () => {
    const onReset = vi.fn();
    const { rerender } = render(<Harness resetKeys={["a"]} shouldThrow onReset={onReset} />);
    rerender(<Harness resetKeys={["b"]} shouldThrow={false} onReset={onReset} />);
    expect(onReset).toHaveBeenCalledExactlyOnceWith("keys");

    onReset.mockClear();
    rerender(<Harness resetKeys={["c"]} shouldThrow onReset={onReset} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Not `shouldThrow` any more, so the retry actually succeeds — see the
    // test below for what happens when it does not.
    rerender(<Harness resetKeys={["c"]} shouldThrow={false} onReset={onReset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onReset).toHaveBeenCalledExactlyOnceWith("imperative");
  });

  it("does not report a reset when the retry immediately throws again", () => {
    // `onReset` means "the boundary is showing its children again", not "the
    // button was pressed". A deterministic error re-throws inside the same
    // update, so the boundary never commits a recovered state and there is no
    // reset to report. `RouteErrorBoundary` counts attempts at the click
    // instead, which is why its escalation still advances here.
    const onReset = vi.fn();
    render(<Harness resetKeys={["a"]} shouldThrow onReset={onReset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(onReset).not.toHaveBeenCalled();
  });

  it("does not call onReset when nothing was wrong", () => {
    const onReset = vi.fn();
    const { rerender } = render(
      <Harness resetKeys={["a"]} shouldThrow={false} onReset={onReset} />,
    );
    rerender(<Harness resetKeys={["b"]} shouldThrow={false} onReset={onReset} />);
    expect(onReset).not.toHaveBeenCalled();
  });

  it("labels a key-driven reset that follows a failed retry correctly", () => {
    /*
     * Regression: the reason used to be recorded when `reset()` ran and
     * consumed when the boundary recovered. A retry against a deterministic
     * error re-throws in the same update and never recovers, so the recorded
     * "imperative" survived and mislabelled the *next* reset — the key-driven
     * one on the following navigation. Anything keyed on `"keys"` (the route
     * boundary's retry budget) then stopped resetting after the first failed
     * retry, with nothing to show for it.
     */
    const onReset = vi.fn();
    const { rerender } = render(<Harness resetKeys={["a"]} shouldThrow onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onReset).not.toHaveBeenCalled();

    rerender(<Harness resetKeys={["b"]} shouldThrow={false} onReset={onReset} />);
    expect(onReset).toHaveBeenCalledExactlyOnceWith("keys");
  });

  it("does not clear on an unrelated state change in the parent", () => {
    function Parent() {
      const [count, setCount] = useState(0);
      return (
        <div>
          <button
            onClick={() => {
              setCount((c) => c + 1);
            }}
          >
            bump {count}
          </button>
          <ErrorBoundary resetKeys={["stable"]}>
            <ThrowingChild shouldThrow />
          </ErrorBoundary>
        </div>
      );
    }
    render(<Parent />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /bump/ }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("ErrorBoundary onError", () => {
  it("is called once per caught error, with the component stack", () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledOnce();
    const [error, info] = onError.mock.calls[0] as [Error, { componentStack?: string }];
    expect(error.message).toBe("Test error message");
    expect(info.componentStack).toContain("ThrowingChild");
  });

  it("replaces the default console logging rather than adding to it", () => {
    render(
      <ErrorBoundary onError={vi.fn()}>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>,
    );
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      "[ErrorBoundary]",
      expect.anything(),
      expect.anything(),
    );
  });

  it("still logs when no handler is supplied", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>,
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[ErrorBoundary]",
      expect.anything(),
      expect.anything(),
    );
  });
});
