import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stack } from "./Stack";

describe("Stack", () => {
  it("renders children", () => {
    render(<Stack>Content</Stack>);
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("renders as a div", () => {
    const { container } = render(<Stack>Content</Stack>);
    expect(container.firstChild?.nodeName).toBe("DIV");
  });

  it("applies flex class", () => {
    const { container } = render(<Stack>Content</Stack>);
    expect((container.firstChild as HTMLElement).className).toContain("flex");
  });

  it("defaults to column direction", () => {
    const { container } = render(<Stack>Content</Stack>);
    expect((container.firstChild as HTMLElement).className).toContain("flex-col");
  });

  it("applies row direction", () => {
    const { container } = render(<Stack direction="row">Content</Stack>);
    expect((container.firstChild as HTMLElement).className).toContain("flex-row");
  });

  it("applies default md gap", () => {
    const { container } = render(<Stack>Content</Stack>);
    expect((container.firstChild as HTMLElement).className).toContain("gap-4");
  });

  it("applies none gap", () => {
    const { container } = render(<Stack gap="none">Content</Stack>);
    expect((container.firstChild as HTMLElement).className).toContain("gap-0");
  });

  it("applies xs gap", () => {
    const { container } = render(<Stack gap="xs">Content</Stack>);
    expect((container.firstChild as HTMLElement).className).toContain("gap-1");
  });

  it("applies xl gap", () => {
    const { container } = render(<Stack gap="xl">Content</Stack>);
    expect((container.firstChild as HTMLElement).className).toContain("gap-8");
  });

  it("applies default stretch alignment", () => {
    const { container } = render(<Stack>Content</Stack>);
    expect((container.firstChild as HTMLElement).className).toContain("items-stretch");
  });

  it("applies center alignment", () => {
    const { container } = render(<Stack align="center">Content</Stack>);
    expect((container.firstChild as HTMLElement).className).toContain("items-center");
  });

  it("applies end alignment", () => {
    const { container } = render(<Stack align="end">Content</Stack>);
    expect((container.firstChild as HTMLElement).className).toContain("items-end");
  });

  it("applies baseline alignment", () => {
    const { container } = render(<Stack align="baseline">Content</Stack>);
    expect((container.firstChild as HTMLElement).className).toContain("items-baseline");
  });

  it("applies default start justify", () => {
    const { container } = render(<Stack>Content</Stack>);
    expect((container.firstChild as HTMLElement).className).toContain("justify-start");
  });

  it("applies between justify", () => {
    const { container } = render(<Stack justify="between">Content</Stack>);
    expect((container.firstChild as HTMLElement).className).toContain("justify-between");
  });

  it("applies center justify", () => {
    const { container } = render(<Stack justify="center">Content</Stack>);
    expect((container.firstChild as HTMLElement).className).toContain("justify-center");
  });

  it("does not apply flex-wrap by default", () => {
    const { container } = render(<Stack>Content</Stack>);
    expect((container.firstChild as HTMLElement).className).not.toContain("flex-wrap");
  });

  it("applies flex-wrap when wrap=true", () => {
    const { container } = render(<Stack wrap>Content</Stack>);
    expect((container.firstChild as HTMLElement).className).toContain("flex-wrap");
  });

  it("merges custom className", () => {
    const { container } = render(<Stack className="my-stack">Content</Stack>);
    expect((container.firstChild as HTMLElement).className).toContain("my-stack");
  });

  it("forwards additional HTML attributes", () => {
    render(<Stack data-testid="stack">Content</Stack>);
    expect(screen.getByTestId("stack")).toBeInTheDocument();
  });
});
