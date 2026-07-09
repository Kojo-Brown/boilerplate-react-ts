import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { HomePageSkeleton } from "@/components/skeletons/HomePageSkeleton";

describe("HomePageSkeleton", () => {
  it("renders with loading state attributes", () => {
    render(<HomePageSkeleton />);
    expect(screen.getByLabelText("Loading home page")).toHaveAttribute("aria-busy", "true");
  });

  it("renders multiple skeleton placeholders", () => {
    render(<HomePageSkeleton />);
    expect(screen.getAllByRole("status").length).toBeGreaterThanOrEqual(3);
  });
});
