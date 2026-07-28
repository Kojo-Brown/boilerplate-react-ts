import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { ErrorBoundary, ErrorFallback } from "./ErrorBoundary";

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
