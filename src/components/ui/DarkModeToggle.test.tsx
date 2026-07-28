import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/context/ThemeContext";
import { DarkModeToggle } from "./DarkModeToggle";

function wrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

function makeMediaQuery(matches: boolean) {
  return {
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  vi.spyOn(window, "matchMedia").mockReturnValue(
    makeMediaQuery(false) as unknown as MediaQueryList,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DarkModeToggle", () => {
  it("renders with system theme by default", () => {
    render(<DarkModeToggle />, { wrapper });
    expect(screen.getByRole("button")).toHaveAttribute("title", "System theme");
  });

  it("cycles from system → light on first click", () => {
    render(<DarkModeToggle />, { wrapper });
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveAttribute("title", "Light theme");
  });

  it("cycles from light → dark on second click", () => {
    render(<DarkModeToggle />, { wrapper });
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveAttribute("title", "Dark theme");
  });

  it("cycles from dark → system on third click", () => {
    render(<DarkModeToggle />, { wrapper });
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveAttribute("title", "System theme");
  });

  it("has correct aria-label for next action from system mode", () => {
    render(<DarkModeToggle />, { wrapper });
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Switch to light theme");
  });

  it("has correct aria-label for next action from light mode", () => {
    render(<DarkModeToggle />, { wrapper });
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Switch to dark theme");
  });

  it("has correct aria-label for next action from dark mode", () => {
    render(<DarkModeToggle />, { wrapper });
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Switch to system theme");
  });

  it("applies .dark class when toggled to dark mode", () => {
    render(<DarkModeToggle />, { wrapper });
    // system → light
    fireEvent.click(screen.getByRole("button"));
    // light → dark
    fireEvent.click(screen.getByRole("button"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes .dark class when toggled to light mode", () => {
    document.documentElement.classList.add("dark");
    render(<DarkModeToggle />, { wrapper });
    // system → light (OS is not dark, so this removes dark)
    fireEvent.click(screen.getByRole("button"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("accepts a custom className", () => {
    render(<DarkModeToggle className="custom-class" />, { wrapper });
    expect(screen.getByRole("button")).toHaveClass("custom-class");
  });
});
