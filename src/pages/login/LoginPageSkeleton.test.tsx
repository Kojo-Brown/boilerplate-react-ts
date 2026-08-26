import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { LoginPageSkeleton } from "@/pages/login/LoginPageSkeleton";

describe("LoginPageSkeleton", () => {
  it("renders with loading state attributes", () => {
    render(<LoginPageSkeleton />);
    expect(screen.getByRole("status", { name: "Loading login page" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("renders form field skeletons", () => {
    const { container } = render(<LoginPageSkeleton />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(6);
  });
});
