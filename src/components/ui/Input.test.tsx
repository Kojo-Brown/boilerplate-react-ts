import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input } from "./Input";

describe("Input", () => {
  it("renders a text input by default", () => {
    render(<Input aria-label="Name" />);
    expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
  });

  it("forwards placeholder to the input element", () => {
    render(<Input aria-label="Name" placeholder="Enter name" />);
    expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "Enter name");
  });

  it("forwards type attribute", () => {
    render(<Input aria-label="Password" type="password" />);
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("applies error class when error is true", () => {
    render(<Input aria-label="Name" error />);
    const input = screen.getByRole("textbox");
    expect(input.className).toContain("border-[var(--color-danger)]");
  });

  it("does not apply error class when error is false", () => {
    render(<Input aria-label="Name" error={false} />);
    const input = screen.getByRole("textbox");
    expect(input.className).not.toContain("border-[var(--color-danger)]");
  });

  it("is disabled when disabled prop is set", () => {
    render(<Input aria-label="Name" disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("merges custom className", () => {
    render(<Input aria-label="Name" className="my-custom-class" />);
    expect(screen.getByRole("textbox").className).toContain("my-custom-class");
  });
});
