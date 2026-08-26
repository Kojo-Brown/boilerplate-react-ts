import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DashboardPageSkeleton } from "@/pages/dashboard/DashboardPageSkeleton";

describe("DashboardPageSkeleton", () => {
  it("renders with loading state attributes", () => {
    render(<DashboardPageSkeleton />);
    expect(screen.getByRole("status", { name: "Loading dashboard" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("renders stat card skeletons", () => {
    const { container } = render(<DashboardPageSkeleton />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(6);
  });
});
