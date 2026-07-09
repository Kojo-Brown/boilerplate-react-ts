import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Skeleton } from "@/components/ui/Skeleton";

describe("Skeleton", () => {
  it("renders with default aria attributes", () => {
    render(<Skeleton />);
    const el = screen.getByRole("status");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("aria-busy", "true");
    expect(el).toHaveAttribute("aria-label", "Loading…");
  });

  it("accepts a custom aria-label", () => {
    render(<Skeleton aria-label="Loading profile picture" />);
    expect(screen.getByLabelText("Loading profile picture")).toBeInTheDocument();
  });

  it("applies circle variant class", () => {
    render(<Skeleton variant="circle" />);
    expect(screen.getByRole("status")).toHaveClass("rounded-full");
  });

  it("applies text variant class", () => {
    render(<Skeleton variant="text" />);
    expect(screen.getByRole("status")).toHaveClass("h-4");
  });

  it("applies rect variant class by default", () => {
    render(<Skeleton />);
    expect(screen.getByRole("status")).toHaveClass("rounded-md");
  });

  it("forwards width and height as inline styles", () => {
    render(<Skeleton width="120px" height="40px" />);
    const el = screen.getByRole("status");
    expect(el).toHaveStyle({ width: "120px", height: "40px" });
  });

  it("merges custom className", () => {
    render(<Skeleton className="w-32" />);
    expect(screen.getByRole("status")).toHaveClass("w-32");
  });
});
