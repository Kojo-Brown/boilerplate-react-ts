import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ImageLabPage } from "@/pages/image-lab/ImageLabPage";
import { DEMO_STABILITY, DEMO_TILES } from "@/shared/lib/demoImages";

function heroImage(): HTMLImageElement {
  return screen.getByTestId("hero-image");
}

describe("ImageLabPage", () => {
  it("marks exactly one image as the priority one", () => {
    // The hint is a ranking. A page where every image is high has ranked
    // nothing, so the lab has to be an example of restraint as well as of the
    // attributes.
    render(<ImageLabPage />);
    const prioritised = screen
      .getAllByRole("img")
      .filter((img) => img.getAttribute("fetchpriority") === "high");
    expect(prioritised).toHaveLength(1);
    expect(prioritised[0]).toBe(heroImage());
  });

  it("gives the hero all four priority attributes", () => {
    render(<ImageLabPage />);
    const hero = heroImage();
    expect(hero).toHaveAttribute("loading", "eager");
    expect(hero).toHaveAttribute("decoding", "sync");
    expect(hero).toHaveAttribute("fetchpriority", "high");
    expect(hero).not.toHaveClass("opacity-0");
  });

  it("leaves the tiles lazy and unprioritised", () => {
    render(<ImageLabPage />);
    for (const tile of DEMO_TILES) {
      const img = screen.getByAltText(tile.alt);
      expect(img).toHaveAttribute("loading", "lazy");
      expect(img).toHaveAttribute("fetchpriority", "auto");
    }
  });

  it("offers AVIF first and JPEG last for the hero", () => {
    const { container } = render(<ImageLabPage />);
    const picture = heroImage().closest("picture");
    const types = [...(picture?.querySelectorAll("source") ?? [])].map((source) => source.type);
    expect(types).toEqual(["image/avif", "image/webp"]);
    expect(heroImage().getAttribute("src")).toMatch(/\.jpeg\?run=1$/);
    expect(container).toBeTruthy();
  });

  it("describes the hero's layout width rather than defaulting to 100vw", () => {
    // The page caps its content at 72rem, so above that breakpoint the hero
    // stops growing. `100vw` would buy the 1600px candidate for a 1152px box.
    render(<ImageLabPage />);
    expect(heroImage()).toHaveAttribute("sizes", "(min-width: 72rem) 72rem, 100vw");
  });

  it("changes every candidate URL when the images are reloaded", () => {
    // A repeat against a warm cache paints in the frame it is asked for and
    // shifts nothing, which would report a stability the page does not have.
    render(<ImageLabPage />);
    expect(heroImage().getAttribute("srcset")).toContain("?run=1");
    fireEvent.click(screen.getByTestId("reload-images"));
    expect(heroImage().getAttribute("srcset")).toContain("?run=2");
    expect(heroImage().getAttribute("srcset")).not.toContain("?run=1");
  });

  it("hides the unreserved arm until it is asked for", () => {
    render(<ImageLabPage />);
    expect(screen.queryByTestId("unreserved-arm")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("toggle-unreserved"));
    const arm = screen.getByTestId("unreserved-arm");
    const img = within(arm).getByRole("img");
    // The point of the arm: no dimensions, no ratio, nothing holding a box.
    expect(img).not.toHaveAttribute("width");
    expect(img).not.toHaveAttribute("height");
    expect(img).not.toHaveAttribute("srcset");
  });

  it("keeps a reserved box on the arm that has one", () => {
    render(<ImageLabPage />);
    const reserved = within(screen.getByTestId("reserved-arm")).getByRole("img");
    const box = reserved.closest("div[style]");
    expect(box).toHaveStyle({
      aspectRatio: `${DEMO_STABILITY.width} / ${DEMO_STABILITY.height}`,
    });
  });

  it("says the shift meter is unavailable rather than reporting a zero it cannot measure", () => {
    // jsdom implements no `PerformanceObserver`, and neither do Firefox or
    // WebKit for `layout-shift`. A meter reading 0.0000 there would be a
    // claim; "unsupported" is the truth.
    render(<ImageLabPage />);
    expect(screen.getByTestId("cls-value")).toHaveTextContent("unsupported");
  });

  it("shows the selected candidate only once the hero has loaded", () => {
    render(<ImageLabPage />);
    expect(screen.getByTestId("hero-current-src")).toHaveTextContent("loading…");
    fireEvent.load(heroImage());
    expect(screen.getByTestId("hero-natural-size")).toHaveTextContent("×");
  });
});
