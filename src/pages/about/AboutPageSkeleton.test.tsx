import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AboutPageSkeleton } from "@/pages/about/AboutPageSkeleton";

describe("AboutPageSkeleton", () => {
  it("renders with loading state attributes", () => {
    render(<AboutPageSkeleton />);
    expect(screen.getByRole("status", { name: "Loading about page" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("renders multiple skeleton placeholders", () => {
    const { container } = render(<AboutPageSkeleton />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(4);
  });
});
