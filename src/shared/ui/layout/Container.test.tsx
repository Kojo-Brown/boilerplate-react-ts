import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Container } from "@/shared/ui/layout/Container";

describe("Container", () => {
  it("renders children", () => {
    render(<Container>Content</Container>);
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("renders as a div by default", () => {
    const { container } = render(<Container>Content</Container>);
    expect(container.firstChild?.nodeName).toBe("DIV");
  });

  it("applies centering and base padding classes by default", () => {
    const { container } = render(<Container>Content</Container>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("mx-auto");
    expect(el.className).toContain("w-full");
    expect(el.className).toContain("px-4");
  });

  it("applies default xl max-width", () => {
    const { container } = render(<Container>Content</Container>);
    expect((container.firstChild as HTMLElement).className).toContain("max-w-screen-xl");
  });

  it("applies sm max-width", () => {
    const { container } = render(<Container size="sm">Content</Container>);
    expect((container.firstChild as HTMLElement).className).toContain("max-w-screen-sm");
  });

  it("applies md max-width", () => {
    const { container } = render(<Container size="md">Content</Container>);
    expect((container.firstChild as HTMLElement).className).toContain("max-w-screen-md");
  });

  it("applies lg max-width", () => {
    const { container } = render(<Container size="lg">Content</Container>);
    expect((container.firstChild as HTMLElement).className).toContain("max-w-screen-lg");
  });

  it("applies 2xl max-width", () => {
    const { container } = render(<Container size="2xl">Content</Container>);
    expect((container.firstChild as HTMLElement).className).toContain("max-w-screen-2xl");
  });

  it("applies full max-width", () => {
    const { container } = render(<Container size="full">Content</Container>);
    expect((container.firstChild as HTMLElement).className).toContain("max-w-full");
  });

  it("merges custom className", () => {
    const { container } = render(<Container className="my-container">Content</Container>);
    expect((container.firstChild as HTMLElement).className).toContain("my-container");
  });

  it("forwards additional HTML attributes", () => {
    render(<Container data-testid="ctr">Content</Container>);
    expect(screen.getByTestId("ctr")).toBeInTheDocument();
  });
});
