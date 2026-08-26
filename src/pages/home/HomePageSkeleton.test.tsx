import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { HomePageSkeleton } from "@/pages/home/HomePageSkeleton";

describe("HomePageSkeleton", () => {
  it("renders with loading state attributes", () => {
    render(<HomePageSkeleton />);
    expect(screen.getByRole("status", { name: "Loading home page" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("renders multiple skeleton placeholders", () => {
    const { container } = render(<HomePageSkeleton />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(3);
  });
});
