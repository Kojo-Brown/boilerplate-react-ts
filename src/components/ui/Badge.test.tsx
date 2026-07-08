import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders children", () => {
    render(<Badge>New</Badge>);
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("renders as an inline span", () => {
    const { container } = render(<Badge>Tag</Badge>);
    expect(container.querySelector("span")).toBeInTheDocument();
  });

  it("applies default variant classes", () => {
    render(<Badge>Default</Badge>);
    expect(screen.getByText("Default").className).toContain("bg-[var(--color-muted)]");
  });

  it("applies primary variant classes", () => {
    render(<Badge variant="primary">Primary</Badge>);
    expect(screen.getByText("Primary").className).toContain("bg-[var(--color-primary)]");
  });

  it("applies success variant classes", () => {
    render(<Badge variant="success">Active</Badge>);
    expect(screen.getByText("Active").className).toContain("bg-[var(--color-success)]");
  });

  it("applies danger variant classes", () => {
    render(<Badge variant="danger">Error</Badge>);
    expect(screen.getByText("Error").className).toContain("bg-[var(--color-danger)]");
  });

  it("applies outline variant classes", () => {
    render(<Badge variant="outline">Tag</Badge>);
    expect(screen.getByText("Tag").className).toContain("border");
  });

  it("merges custom className", () => {
    render(<Badge className="my-badge">Tag</Badge>);
    expect(screen.getByText("Tag").className).toContain("my-badge");
  });
});
