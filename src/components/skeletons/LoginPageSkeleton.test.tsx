import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { LoginPageSkeleton } from "@/components/skeletons/LoginPageSkeleton";

describe("LoginPageSkeleton", () => {
  it("renders with loading state attributes", () => {
    render(<LoginPageSkeleton />);
    expect(screen.getByLabelText("Loading login page")).toHaveAttribute("aria-busy", "true");
  });

  it("renders form field skeletons", () => {
    render(<LoginPageSkeleton />);
    expect(screen.getAllByRole("status").length).toBeGreaterThanOrEqual(6);
  });
});
