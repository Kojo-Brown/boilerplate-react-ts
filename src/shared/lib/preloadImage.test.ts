import { describe, it, expect } from "vitest";
// Importing the client entry is what installs React's resource dispatcher and
// gives it a document to hoist into. Without it `preload` is the no-op
// implementation and every assertion below would pass vacuously against an
// empty `<head>`.
import "react-dom/client";
import { preloadImage } from "@/shared/lib/preloadImage";
import type { ImageTransform } from "@/shared/lib/responsiveImage";

const pathTransform: ImageTransform = ({ src, width, format }) => `${src}-${width}.${format}`;

/**
 * Every test uses a distinct `src`, and nothing removes the links between
 * them.
 *
 * That is not tidiness, it is the only correct way to test this: React's
 * dedupe is a module-level map of what it has already emitted, so deleting a
 * link from `<head>` does not un-emit it. A `beforeEach` that clears the
 * document leaves the map populated and every later call silently does
 * nothing — which reads, from the assertions, exactly like a broken
 * `preloadImage`.
 */
function linksFor(token: string): HTMLLinkElement[] {
  return [
    ...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]'),
  ].filter((link) => link.getAttribute("imagesrcset")?.includes(token) === true);
}

describe("preloadImage", () => {
  it("emits exactly one preload for a multi-format image", () => {
    // One per format would double-download in any browser that supports two of
    // them, which today is nearly all of them.
    preloadImage({
      src: "/one-per-image",
      widths: [640, 1280],
      formats: ["avif", "webp", "jpeg"],
      transform: pathTransform,
      sizes: "100vw",
    });
    expect(linksFor("/one-per-image")).toHaveLength(1);
  });

  it("preloads the first format and announces its type", () => {
    preloadImage({
      src: "/best-format",
      widths: [640, 1280],
      formats: ["avif", "webp", "jpeg"],
      transform: pathTransform,
      sizes: "100vw",
    });
    const [link] = linksFor("/best-format");
    // The `type` is what makes one preload safe: a browser that cannot decode
    // AVIF drops the hint, and that is the same browser that will not select
    // the AVIF `<source>` either.
    expect(link).toHaveAttribute("type", "image/avif");
    expect(link).toHaveAttribute(
      "imagesrcset",
      "/best-format-640.avif 640w, /best-format-1280.avif 1280w",
    );
  });

  it("repeats `sizes` as `imagesizes` so the preload resolves the same candidate", () => {
    // Preload candidate selection runs the element's algorithm. Identical
    // inputs are the only reason the hint and the element agree on one URL
    // rather than fetching two.
    preloadImage({
      src: "/mirrored-sizes",
      widths: [640, 1280],
      formats: ["avif", "jpeg"],
      transform: pathTransform,
      sizes: "(min-width: 60rem) 50vw, 100vw",
    });
    expect(linksFor("/mirrored-sizes")[0]).toHaveAttribute(
      "imagesizes",
      "(min-width: 60rem) 50vw, 100vw",
    );
  });

  it("defaults the priority hint to high", () => {
    preloadImage({
      src: "/default-priority",
      widths: [640],
      formats: ["avif", "jpeg"],
      transform: pathTransform,
      sizes: "100vw",
    });
    expect(linksFor("/default-priority")[0]).toHaveAttribute("fetchpriority", "high");
  });

  it("honours an explicit low priority", () => {
    preloadImage({
      src: "/low-priority",
      widths: [640],
      formats: ["avif", "jpeg"],
      transform: pathTransform,
      sizes: "100vw",
      fetchPriority: "low",
    });
    expect(linksFor("/low-priority")[0]).toHaveAttribute("fetchpriority", "low");
  });

  it("drops `href`, because the candidate list is the address", () => {
    // React sets `href: undefined` whenever `as: 'image'` is given an
    // `imageSrcSet`. Worth pinning: the natural expectation is that the
    // fallback URL passed in gets preloaded as well, and it does not.
    preloadImage({
      src: "/no-href",
      widths: [640],
      formats: ["avif", "jpeg"],
      transform: pathTransform,
      sizes: "100vw",
    });
    expect(linksFor("/no-href")[0]).not.toHaveAttribute("href");
  });

  it("is idempotent for the same image", () => {
    // A StrictMode double render, or a route module and its child both asking,
    // must not produce two links. React keys its dedupe on
    // `imagesrcset` + `imagesizes`.
    const input = {
      src: "/idempotent",
      widths: [640, 1280],
      formats: ["avif", "jpeg"] as const,
      transform: pathTransform,
      sizes: "100vw",
    };
    preloadImage(input);
    preloadImage(input);
    expect(linksFor("/idempotent")).toHaveLength(1);
  });

  it("emits a separate preload for a different image", () => {
    const base = {
      widths: [640],
      formats: ["avif", "jpeg"] as const,
      transform: pathTransform,
      sizes: "100vw",
    };
    preloadImage({ ...base, src: "/distinct-a" });
    preloadImage({ ...base, src: "/distinct-b" });
    expect(linksFor("/distinct-a")).toHaveLength(1);
    expect(linksFor("/distinct-b")).toHaveLength(1);
  });

  it("emits a separate preload when only `sizes` differs", () => {
    // Two layouts of one image resolve to different candidates, so they are
    // different requests — the dedupe key includes `imagesizes` for exactly
    // this reason.
    const base = {
      src: "/two-layouts",
      widths: [640, 1280],
      formats: ["avif", "jpeg"] as const,
      transform: pathTransform,
    };
    preloadImage({ ...base, sizes: "100vw" });
    preloadImage({ ...base, sizes: "50vw" });
    expect(linksFor("/two-layouts")).toHaveLength(2);
  });

  it("preloads the only format when just one is offered", () => {
    preloadImage({
      src: "/single-format",
      widths: [640],
      formats: ["png"],
      transform: pathTransform,
      sizes: "100vw",
    });
    expect(linksFor("/single-format")[0]).toHaveAttribute("type", "image/png");
  });
});
