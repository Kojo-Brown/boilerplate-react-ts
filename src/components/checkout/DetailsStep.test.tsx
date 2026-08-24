import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ShippingField } from "@/lib/checkoutSchemas";
import { DetailsStep, type FieldDescriptor } from "./DetailsStep";

const fields: readonly FieldDescriptor<ShippingField>[] = [
  { name: "fullName", label: "Full name" },
  { name: "line1", label: "Address" },
  { name: "city", label: "Town or city" },
  { name: "postcode", label: "Postcode" },
];

function renderStep(overrides: Partial<Parameters<typeof DetailsStep<ShippingField>>[0]> = {}) {
  const props = {
    headingId: "shipping-heading",
    heading: "Where should it go?",
    fields,
    values: { fullName: "", line1: "", city: "", postcode: "" },
    errors: {},
    message: null,
    nextLabel: "Continue",
    onChange: vi.fn(),
    onBack: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  };
  render(<DetailsStep<ShippingField> {...props} />);
  return props;
}

describe("DetailsStep", () => {
  it("renders one control per descriptor", () => {
    renderStep();

    for (const field of fields) {
      expect(screen.getByLabelText(new RegExp(field.label))).toBeInTheDocument();
    }
  });

  it("reports the field name alongside the value", async () => {
    const user = userEvent.setup();
    const props = renderStep();

    await user.type(screen.getByLabelText(/Town or city/), "A");

    expect(props.onChange).toHaveBeenLastCalledWith("city", "A");
  });

  it("submits through the form so Enter works, and never natively", async () => {
    // `noValidate` plus `preventDefault`: the browser's own bubble cannot say
    // what the machine's guard knows, and two refusals for one click is worse
    // than either.
    const user = userEvent.setup();
    const props = renderStep();

    await user.type(screen.getByLabelText(/Full name/), "{Enter}");

    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  it("puts a field's error under it and marks the control invalid", () => {
    renderStep({ errors: { postcode: "Enter a valid UK postcode." } });

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid UK postcode.");
    expect(screen.getByLabelText(/Postcode/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Full name/)).not.toHaveAttribute("aria-invalid", "true");
  });

  it("shows a step-level message separately from the field errors", () => {
    renderStep({ message: "We do not deliver there." });

    expect(screen.getByTestId("step-message")).toHaveTextContent("We do not deliver there.");
  });

  it("goes back without submitting", async () => {
    const user = userEvent.setup();
    const props = renderStep();

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(props.onBack).toHaveBeenCalledTimes(1);
    expect(props.onNext).not.toHaveBeenCalled();
  });
});
