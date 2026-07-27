import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormField } from "./FormField";

describe("FormField", () => {
  it("renders the label text", () => {
    render(
      <FormField label="Email">
        <input />
      </FormField>,
    );
    expect(screen.getByText("Email")).toBeInTheDocument();
  });

  it("renders children inside the field", () => {
    render(
      <FormField label="Email">
        <input data-testid="email-input" />
      </FormField>,
    );
    expect(screen.getByTestId("email-input")).toBeInTheDocument();
  });

  it("label is implicitly associated with the child input", () => {
    render(
      <FormField label="Username">
        <input />
      </FormField>,
    );
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
  });

  it("renders required asterisk when required is true", () => {
    render(
      <FormField label="Email" required>
        <input />
      </FormField>,
    );
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("does not render asterisk when required is false or omitted", () => {
    render(
      <FormField label="Email">
        <input />
      </FormField>,
    );
    expect(screen.queryByText("*")).not.toBeInTheDocument();
  });

  it("renders error message with role=alert", () => {
    render(
      <FormField label="Email" error="Invalid email address">
        <input />
      </FormField>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Invalid email address");
  });

  it("does not render an alert when error is undefined", () => {
    render(
      <FormField label="Email">
        <input />
      </FormField>,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders hint text when no error is present", () => {
    render(
      <FormField label="Email" hint="We will never share your email">
        <input />
      </FormField>,
    );
    expect(screen.getByText("We will never share your email")).toBeInTheDocument();
  });

  it("hides hint text when an error is present", () => {
    render(
      <FormField label="Email" hint="We will never share your email" error="Required">
        <input />
      </FormField>,
    );
    expect(screen.queryByText("We will never share your email")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
  });
});
