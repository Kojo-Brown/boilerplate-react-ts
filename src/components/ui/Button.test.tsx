import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("is disabled when disabled prop is true", () => {
    render(<Button disabled>Click me</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("is disabled when loading is true", () => {
    render(<Button loading>Click me</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("shows spinner svg when loading", () => {
    const { container } = render(<Button loading>Click me</Button>);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click me</Button>);
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not call onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Click me
      </Button>,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("applies primary variant class by default", () => {
    render(<Button>Click</Button>);
    expect(screen.getByRole("button").className).toContain("bg-[var(--color-primary)]");
  });

  it("applies danger variant class", () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole("button").className).toContain("bg-[var(--color-danger)]");
  });

  it("merges custom className", () => {
    render(<Button className="my-class">Click</Button>);
    expect(screen.getByRole("button").className).toContain("my-class");
  });
});
