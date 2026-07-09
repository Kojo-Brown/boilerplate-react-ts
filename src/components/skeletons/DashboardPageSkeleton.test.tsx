import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DashboardPageSkeleton } from "@/components/skeletons/DashboardPageSkeleton";

describe("DashboardPageSkeleton", () => {
  it("renders with loading state attributes", () => {
    render(<DashboardPageSkeleton />);
    expect(screen.getByLabelText("Loading dashboard")).toHaveAttribute("aria-busy", "true");
  });

  it("renders stat card skeletons", () => {
    render(<DashboardPageSkeleton />);
    expect(screen.getAllByRole("status").length).toBeGreaterThanOrEqual(6);
  });
});
