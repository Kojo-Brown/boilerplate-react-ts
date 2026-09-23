import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SkipLink, MAIN_CONTENT_ID } from "@/shared/ui/SkipLink";

function renderWithTarget() {
  const target = document.createElement("main");
  target.id = MAIN_CONTENT_ID;
  target.tabIndex = -1;
  target.textContent = "page content";
  document.body.append(target);
  return render(<SkipLink targetId={MAIN_CONTENT_ID}>Skip to main content</SkipLink>);
}

afterEach(() => {
  document.querySelector("main")?.remove();
});

describe("SkipLink", () => {
  it("is a link, so it appears in a screen reader's links list", () => {
    renderWithTarget();
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute(
      "href",
      `#${MAIN_CONTENT_ID}`,
    );
  });

  it("is the first thing Tab reaches", async () => {
    const user = userEvent.setup();
    renderWithTarget();

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link"));
  });

  it("is visually hidden until it has focus", async () => {
    const user = userEvent.setup();
    renderWithTarget();
    const link = screen.getByRole("link");

    // `sr-only` keeps it in the tab order, which is the entire mechanism —
    // `display: none` would make it unfocusable and therefore useless.
    expect(link).toHaveClass("sr-only");
    expect(link.className).toContain("focus:not-sr-only");

    await user.tab();
    expect(document.activeElement).toBe(link);
  });

  it("moves focus to the target", async () => {
    const user = userEvent.setup();
    renderWithTarget();

    await user.click(screen.getByRole("link"));
    expect(document.activeElement).toBe(document.getElementById(MAIN_CONTENT_ID));
  });

  it("leaves the fragment out of the URL", async () => {
    const user = userEvent.setup();
    const before = window.location.hash;
    renderWithTarget();

    await user.click(screen.getByRole("link"));

    // A `#main-content` left in the address bar outlives the click: it is
    // copied with the URL and read by `<ScrollRestoration>` on every later
    // navigation.
    expect(window.location.hash).toBe(before);
  });

  it("leaves the browser's own behaviour alone when the target is missing", async () => {
    const user = userEvent.setup();
    render(<SkipLink targetId="nothing-here">Skip to main content</SkipLink>);

    // No target, so nothing is prevented and nothing is focused — the anchor's
    // default is the best remaining answer, and a silent no-op is the worst.
    await user.click(screen.getByRole("link"));
    expect(document.activeElement).toBe(screen.getByRole("link"));
  });

  it("merges a caller's classes", () => {
    render(
      <SkipLink targetId={MAIN_CONTENT_ID} className="custom-class">
        Skip to main content
      </SkipLink>,
    );
    expect(screen.getByRole("link")).toHaveClass("custom-class");
  });
});
