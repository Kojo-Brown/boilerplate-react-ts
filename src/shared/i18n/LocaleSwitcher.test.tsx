import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocaleSwitcher } from "@/shared/i18n/LocaleSwitcher";
import { SUPPORTED_LOCALES } from "@/shared/i18n/locales";
import { renderWithIntl } from "@/test/intl";

describe("LocaleSwitcher", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("is a labelled control, named by a real `<label>`", () => {
    // An element rather than an `aria-label`, so voice control ("click
    // Language") and a click on the label both work — neither of which an
    // `aria-label` provides.
    renderWithIntl(<LocaleSwitcher />);
    expect(screen.getByRole("combobox", { name: "Language" })).toBeInTheDocument();
  });

  it("offers every supported locale", () => {
    renderWithIntl(<LocaleSwitcher />);
    expect(screen.getAllByRole("option")).toHaveLength(SUPPORTED_LOCALES.length);
  });

  it("labels each option in its own language", () => {
    /*
     * The one rule this control has. A reader looking for Arabic may not be able
     * to read the current UI language, so "Arabic" in English is the label that
     * fails exactly the person using the switcher.
     */
    renderWithIntl(<LocaleSwitcher />);
    for (const { endonym } of SUPPORTED_LOCALES) {
      expect(screen.getByRole("option", { name: endonym })).toBeInTheDocument();
    }
  });

  it("marks each option with its own language and direction", () => {
    // So a right-to-left name renders as itself inside a left-to-right list.
    renderWithIntl(<LocaleSwitcher />);
    const arabic = screen.getByRole("option", { name: "العربية" });
    expect(arabic).toHaveAttribute("lang", "ar-EG");
    expect(arabic).toHaveAttribute("dir", "rtl");
  });

  it("shows the active locale as the selected value", () => {
    renderWithIntl(<LocaleSwitcher />, { locale: "ar-EG" });
    expect(screen.getByRole("combobox")).toHaveValue("ar-EG");
  });

  it("is labelled in the active language", () => {
    renderWithIntl(<LocaleSwitcher />, { locale: "ar-EG" });
    expect(screen.getByRole("combobox", { name: "اللغة" })).toBeInTheDocument();
  });

  it("switches the document when a locale is chosen", async () => {
    const user = userEvent.setup();
    renderWithIntl(<LocaleSwitcher />);

    await user.selectOptions(screen.getByRole("combobox"), "ar-EG");

    await waitFor(() => {
      expect(document.documentElement.dir).toBe("rtl");
    });
    expect(screen.getByRole("combobox", { name: "اللغة" })).toHaveValue("ar-EG");
  });

  it("does nothing for a value no option offered", () => {
    /*
     * `HTMLSelectElement.value` is a `string` arriving from the DOM, and a
     * `change` can carry one no `<option>` ever offered — an extension, a
     * userscript, a restored form state, or (as here) a select whose value was
     * assigned something it does not contain, which the DOM resolves to `""`.
     * Without the guard, `loadCatalog` indexes a record with a key it does not
     * hold and calls `undefined`.
     */
    renderWithIntl(<LocaleSwitcher />);
    const select = screen.getByRole("combobox");

    fireEvent.change(select, { target: { value: "fr-FR" } });

    expect(document.documentElement.dir).toBe("ltr");
    expect(localStorage.getItem("locale")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Language" })).toBeInTheDocument();
  });
});
