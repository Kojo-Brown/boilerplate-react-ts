import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Spinner } from "./Spinner";

describe("Spinner", () => {
  it("renders with role status", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has default aria-label", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading…");
  });

  it("accepts custom label", () => {
    render(<Spinner label="Saving..." />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Saving...");
  });

  it("applies md size class by default", () => {
    render(<Spinner />);
    expect(screen.getByRole("status").className).toContain("h-6");
  });

  it("applies lg size class", () => {
    render(<Spinner size="lg" />);
    expect(screen.getByRole("status").className).toContain("h-8");
  });

  it("applies xl size class", () => {
    render(<Spinner size="xl" />);
    expect(screen.getByRole("status").className).toContain("h-12");
  });

  it("merges custom className", () => {
    render(<Spinner className="my-spinner" />);
    expect(screen.getByRole("status").className).toContain("my-spinner");
  });
});
