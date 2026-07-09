import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Grid } from "./Grid";

describe("Grid", () => {
  it("renders children", () => {
    render(
      <Grid>
        <div>Item</div>
      </Grid>,
    );
    expect(screen.getByText("Item")).toBeInTheDocument();
  });

  it("renders as a div", () => {
    const { container } = render(<Grid>Content</Grid>);
    expect(container.firstChild?.nodeName).toBe("DIV");
  });

  it("applies grid class", () => {
    const { container } = render(<Grid>Content</Grid>);
    expect((container.firstChild as HTMLElement).className).toContain("grid");
  });

  it("applies default single-column class", () => {
    const { container } = render(<Grid>Content</Grid>);
    expect((container.firstChild as HTMLElement).className).toContain("grid-cols-1");
  });

  it("applies cols=2 class", () => {
    const { container } = render(<Grid cols={2}>Content</Grid>);
    expect((container.firstChild as HTMLElement).className).toContain("grid-cols-2");
  });

  it("applies cols=3 class", () => {
    const { container } = render(<Grid cols={3}>Content</Grid>);
    expect((container.firstChild as HTMLElement).className).toContain("grid-cols-3");
  });

  it("applies cols=12 class", () => {
    const { container } = render(<Grid cols={12}>Content</Grid>);
    expect((container.firstChild as HTMLElement).className).toContain("grid-cols-12");
  });

  it("applies default md gap class", () => {
    const { container } = render(<Grid>Content</Grid>);
    expect((container.firstChild as HTMLElement).className).toContain("gap-4");
  });

  it("applies none gap class", () => {
    const { container } = render(<Grid gap="none">Content</Grid>);
    expect((container.firstChild as HTMLElement).className).toContain("gap-0");
  });

  it("applies xs gap class", () => {
    const { container } = render(<Grid gap="xs">Content</Grid>);
    expect((container.firstChild as HTMLElement).className).toContain("gap-1");
  });

  it("applies lg gap class", () => {
    const { container } = render(<Grid gap="lg">Content</Grid>);
    expect((container.firstChild as HTMLElement).className).toContain("gap-6");
  });

  it("applies responsive cols object — base breakpoint", () => {
    const { container } = render(<Grid cols={{ base: 1, md: 3 }}>Content</Grid>);
    const className = (container.firstChild as HTMLElement).className;
    expect(className).toContain("grid-cols-1");
    expect(className).toContain("md:grid-cols-3");
  });

  it("applies responsive cols across all breakpoints", () => {
    const { container } = render(
      <Grid cols={{ base: 1, sm: 2, md: 3, lg: 4, xl: 6 }}>Content</Grid>,
    );
    const className = (container.firstChild as HTMLElement).className;
    expect(className).toContain("grid-cols-1");
    expect(className).toContain("sm:grid-cols-2");
    expect(className).toContain("md:grid-cols-3");
    expect(className).toContain("lg:grid-cols-4");
    expect(className).toContain("xl:grid-cols-6");
  });

  it("merges custom className", () => {
    const { container } = render(<Grid className="my-grid">Content</Grid>);
    expect((container.firstChild as HTMLElement).className).toContain("my-grid");
  });

  it("forwards additional HTML attributes", () => {
    render(<Grid data-testid="grid">Content</Grid>);
    expect(screen.getByTestId("grid")).toBeInTheDocument();
  });
});
