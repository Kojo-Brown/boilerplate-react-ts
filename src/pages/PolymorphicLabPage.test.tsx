import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { PolymorphicLabPage } from "./PolymorphicLabPage";

function renderLab() {
  return render(
    <MemoryRouter>
      <PolymorphicLabPage />
    </MemoryRouter>,
  );
}

const sample = () => screen.getByText("The quick brown fox jumps over the lazy dog.");
const disableToggle = () => screen.getByRole("checkbox", { name: "Disable all three" });
const clickCount = () => screen.getByTestId("click-count");

describe("PolymorphicLabPage", () => {
  it("renders the sample text as a paragraph to begin with", () => {
    renderLab();
    expect(sample().tagName).toBe("P");
  });

  it("re-renders the sample as whichever element the picker chose", async () => {
    const user = userEvent.setup();
    renderLab();

    await user.click(screen.getByRole("button", { name: "h2", pressed: false }));

    expect(sample().tagName).toBe("H2");
    expect(screen.getByTestId("chosen-element")).toHaveTextContent("<h2>");
  });

  it("never writes `as` into the DOM, whichever element is chosen", async () => {
    const user = userEvent.setup();
    renderLab();

    await user.click(screen.getByRole("button", { name: "blockquote", pressed: false }));

    expect(sample()).not.toHaveAttribute("as");
  });

  /**
   * The three controls look the same and are disabled by three different
   * mechanisms. Asserting the mechanism, not just the appearance, is the point
   * — `<a disabled>` would satisfy a test that only checked for an attribute
   * named `disabled` and would still be a fully working link.
   */
  it("disables the native button with the attribute and the others with ARIA", () => {
    renderLab();

    expect(screen.getByRole("button", { name: "Native button" })).toBeDisabled();

    for (const name of ["Anchor", "Router Link"]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("aria-disabled", "true");
      expect(link).not.toHaveAttribute("disabled");
    }
  });

  it("counts no activations while the controls are disabled", async () => {
    const user = userEvent.setup();
    renderLab();

    await user.click(screen.getByRole("button", { name: "Native button" }));
    await user.click(screen.getByRole("link", { name: "Anchor" }));

    expect(clickCount()).toHaveTextContent("0");
  });

  it("counts activations once the controls are enabled", async () => {
    const user = userEvent.setup();
    renderLab();

    await user.click(disableToggle());

    await user.click(screen.getByRole("button", { name: "Native button" }));
    await user.click(screen.getByRole("link", { name: "Anchor" }));

    expect(clickCount()).toHaveTextContent("2");
    expect(screen.getByRole("link", { name: "Anchor" })).not.toHaveAttribute("aria-disabled");
  });

  it("reads the heading node back through a ref typed by `as`", async () => {
    const user = userEvent.setup();
    renderLab();

    expect(screen.getByText("Nothing read yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Read the node" }));

    expect(screen.getByTestId("measured-tag")).toHaveTextContent("H3");
  });
});
