import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AboutPageSkeleton } from "@/components/skeletons/AboutPageSkeleton";

describe("AboutPageSkeleton", () => {
  it("renders with loading state attributes", () => {
    render(<AboutPageSkeleton />);
    expect(screen.getByLabelText("Loading about page")).toHaveAttribute("aria-busy", "true");
  });

  it("renders multiple skeleton placeholders", () => {
    render(<AboutPageSkeleton />);
    expect(screen.getAllByRole("status").length).toBeGreaterThanOrEqual(4);
  });
});
