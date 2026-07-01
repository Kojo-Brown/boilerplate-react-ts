import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PageLoader } from "@/components/ui/PageLoader";

describe("PageLoader", () => {
  it("renders with a status role for accessibility", () => {
    render(<PageLoader />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has an accessible label", () => {
    render(<PageLoader />);
    expect(screen.getByLabelText("Loading page")).toBeInTheDocument();
  });
});
