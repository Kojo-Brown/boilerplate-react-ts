import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { OptimizedImage } from "@/shared/ui/OptimizedImage";
import type { ImageTransform } from "@/shared/lib/responsiveImage";

const pathTransform: ImageTransform = ({ src, width, format }) => `${src}-${width}.${format}`;

/** The props every render needs, since none of them may be omitted. */
const base = {
  alt: "Harbour at dusk",
  width: 1600,
  height: 900,
  sizes: "100vw",
  widths: [640, 1280],
  transform: pathTransform,
} as const;

function sourcesOf(container: HTMLElement): HTMLSourceElement[] {
  return [...container.querySelectorAll<HTMLSourceElement>("picture > source")];
}

function preloadLinks(token: string): HTMLLinkElement[] {
  return [
    ...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]'),
  ].filter((link) => link.getAttribute("imagesrcset")?.includes(token) === true);
}

describe("OptimizedImage — format negotiation", () => {
  it("emits a <source> per non-fallback format, best first", () => {
    // Document order is the preference order: selection stops at the first
    // decodable type. `webp` before `avif` would make AVIF unreachable while
    // looking identical in review.
    const { container } = render(<OptimizedImage {...base} src="/order" />);
    expect(sourcesOf(container).map((source) => source.type)).toEqual(["image/avif", "image/webp"]);
  });

  it("leaves the fallback format on the <img> rather than in a <source>", () => {
    const { container } = render(<OptimizedImage {...base} src="/fallback" />);
    expect(sourcesOf(container)).toHaveLength(2);
    const img = screen.getByAltText(base.alt);
    expect(img).toHaveAttribute("srcset", "/fallback-640.jpeg 640w, /fallback-1280.jpeg 1280w");
    expect(img).toHaveAttribute("src", "/fallback-1280.jpeg");
  });

  it("repeats `sizes` on every <source>, not just the <img>", () => {
    // Each candidate list resolves against its own `sizes`; an omitted one
    // means `100vw`. Setting it only on the `<img>` leaves it missing from the
    // element that actually gets selected.
    const { container } = render(
      <OptimizedImage {...base} src="/sizes" sizes="(min-width: 60rem) 33vw, 100vw" />,
    );
    for (const source of sourcesOf(container)) {
      expect(source).toHaveAttribute("sizes", "(min-width: 60rem) 33vw, 100vw");
    }
    expect(screen.getByAltText(base.alt)).toHaveAttribute(
      "sizes",
      "(min-width: 60rem) 33vw, 100vw",
    );
  });

  it("honours a custom format list", () => {
    const { container } = render(
      <OptimizedImage {...base} src="/custom" formats={["webp", "png"]} />,
    );
    expect(sourcesOf(container).map((source) => source.type)).toEqual(["image/webp"]);
    expect(screen.getByAltText(base.alt)).toHaveAttribute("src", "/custom-1280.png");
  });

  it("emits no <source> at all for a single-format image", () => {
    const { container } = render(<OptimizedImage {...base} src="/single" formats={["png"]} />);
    expect(sourcesOf(container)).toHaveLength(0);
    expect(screen.getByAltText(base.alt)).toHaveAttribute(
      "srcset",
      "/single-640.png 640w, /single-1280.png 1280w",
    );
  });
});

describe("OptimizedImage — priority", () => {
  it("is lazy, async-decoded and unprioritised by default", () => {
    render(<OptimizedImage {...base} src="/lazy-default" />);
    const img = screen.getByAltText(base.alt);
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
    expect(img).toHaveAttribute("fetchpriority", "auto");
  });

  it("sets all four priority attributes together", () => {
    // Three of the four is indistinguishable from none: a lazy image is still
    // deferred however high its fetch priority, and an async decode still
    // lands in a later frame.
    render(<OptimizedImage {...base} src="/priority-attrs" priority />);
    const img = screen.getByAltText(base.alt);
    expect(img).toHaveAttribute("loading", "eager");
    expect(img).toHaveAttribute("decoding", "sync");
    expect(img).toHaveAttribute("fetchpriority", "high");
  });

  it("never fades in a priority image", () => {
    // An element at `opacity: 0` has not painted, so a fade-in postpones the
    // image being an LCP candidate until the transition starts and then times
    // the transition rather than the network.
    render(<OptimizedImage {...base} src="/no-fade" priority />);
    const img = screen.getByAltText(base.alt);
    expect(img).toHaveClass("opacity-100");
    expect(img).not.toHaveClass("opacity-0");
    expect(img.className).not.toContain("transition-opacity");
  });

  it("fades a non-priority image in on load", () => {
    render(<OptimizedImage {...base} src="/fade" />);
    const img = screen.getByAltText(base.alt);
    expect(img).toHaveClass("opacity-0");
    fireEvent.load(img);
    expect(img).toHaveClass("opacity-100");
  });

  it("preloads the best format when priority is set", () => {
    render(<OptimizedImage {...base} src="/preloaded" priority sizes="50vw" />);
    const [link] = preloadLinks("/preloaded");
    expect(link).toBeDefined();
    expect(link).toHaveAttribute("type", "image/avif");
    expect(link).toHaveAttribute(
      "imagesrcset",
      "/preloaded-640.avif 640w, /preloaded-1280.avif 1280w",
    );
    expect(link).toHaveAttribute("imagesizes", "50vw");
  });

  it("preloads nothing for a lazy image", () => {
    // A preload for an image the browser was told to defer is a contradiction
    // that resolves in favour of the preload — it would load eagerly anyway.
    render(<OptimizedImage {...base} src="/not-preloaded" />);
    expect(preloadLinks("/not-preloaded")).toHaveLength(0);
  });
});

describe("OptimizedImage — reserved box", () => {
  it("reserves the intrinsic ratio on the wrapper", () => {
    // Not on the `<img>`: it is `h-full w-full`, and CSS setting both axes
    // overrides the ratio the width/height attributes would have implied.
    const { container } = render(<OptimizedImage {...base} src="/ratio" />);
    expect(container.firstChild).toHaveStyle({ aspectRatio: "1600 / 900" });
  });

  it("lets an explicit aspectRatio override the intrinsic one", () => {
    const { container } = render(<OptimizedImage {...base} src="/crop" aspectRatio="1 / 1" />);
    expect(container.firstChild).toHaveStyle({ aspectRatio: "1 / 1" });
  });

  it("caps the box at the intrinsic width without pinning it there", () => {
    // A fixed `width` would overflow every viewport narrower than the source
    // and would flatten the layout width `sizes` describes to a constant.
    const { container } = render(<OptimizedImage {...base} src="/box" />);
    expect(container.firstChild).toHaveStyle({ maxWidth: "1600px", width: "100%" });
  });

  it("still sets width and height on the <img>", () => {
    const { container } = render(<OptimizedImage {...base} src="/attrs" />);
    const img = screen.getByAltText(base.alt);
    expect(img).toHaveAttribute("width", "1600");
    expect(img).toHaveAttribute("height", "900");
    expect(container.firstChild).toBeInstanceOf(HTMLDivElement);
  });
});

describe("OptimizedImage — placeholder, errors and pass-through", () => {
  it("paints the blur placeholder until the image loads", () => {
    render(<OptimizedImage {...base} src="/blur" blurDataURL="data:image/png;base64,fake-lqip" />);
    const placeholder = document.querySelector('img[aria-hidden="true"]');
    expect(placeholder).toHaveAttribute("src", "data:image/png;base64,fake-lqip");
    expect(placeholder).toHaveClass("blur-xl");

    fireEvent.load(screen.getByAltText(base.alt));
    expect(document.querySelector('img[aria-hidden="true"]')).not.toBeInTheDocument();
  });

  it("drops the placeholder when the image fails", () => {
    render(
      <OptimizedImage {...base} src="/blur-error" blurDataURL="data:image/png;base64,fake-lqip" />,
    );
    fireEvent.error(screen.getByAltText(base.alt));
    expect(document.querySelector('img[aria-hidden="true"]')).not.toBeInTheDocument();
  });

  it("renders no placeholder when none is supplied", () => {
    render(<OptimizedImage {...base} src="/no-blur" />);
    expect(document.querySelector('img[aria-hidden="true"]')).not.toBeInTheDocument();
  });

  it("shows a labelled fallback when the image fails", () => {
    render(<OptimizedImage {...base} src="/broken" />);
    fireEvent.error(screen.getByAltText(base.alt));
    expect(screen.getByRole("img", { name: `Failed to load: ${base.alt}` })).toBeInTheDocument();
  });

  it("forwards onLoad and onError", () => {
    const onLoad = vi.fn();
    const onError = vi.fn();
    render(<OptimizedImage {...base} src="/callbacks" onLoad={onLoad} onError={onError} />);
    const img = screen.getByAltText(base.alt);
    fireEvent.load(img);
    fireEvent.error(img);
    expect(onLoad).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("merges className onto the box and imgClassName onto the image", () => {
    const { container } = render(
      <OptimizedImage
        {...base}
        src="/classes"
        className="rounded-lg"
        imgClassName="rounded-full"
      />,
    );
    expect(container.firstChild).toHaveClass("rounded-lg");
    expect(screen.getByAltText(base.alt)).toHaveClass("rounded-full");
  });

  it("forwards unowned attributes to the <img>", () => {
    render(<OptimizedImage {...base} src="/passthrough" data-testid="hero" title="Harbour" />);
    const img = screen.getByTestId("hero");
    expect(img).toHaveAttribute("title", "Harbour");
  });

  /*
   * Each owned attribute gets its own element.
   *
   * TypeScript reports one assignability error per JSX element however many
   * attributes are wrong, so putting all four on one element leaves three
   * `@ts-expect-error` directives with nothing to consume — and an unused
   * directive is itself a build error, which is what turned the first version
   * of this test into a compile failure that read like the component was
   * accepting props it rejects.
   *
   * `tsc` fails if any of these stops being necessary, so they are live
   * assertions rather than comments.
   */
  it("refuses `loading`, which `priority` decides", () => {
    // @ts-expect-error -- owned by `priority`.
    render(<OptimizedImage {...base} src="/owned-loading" loading="lazy" />);
    expect(screen.getByAltText(base.alt)).toBeInTheDocument();
  });

  it("refuses `decoding`, which `priority` decides", () => {
    // @ts-expect-error -- owned by `priority`.
    render(<OptimizedImage {...base} src="/owned-decoding" decoding="async" />);
    expect(screen.getByAltText(base.alt)).toBeInTheDocument();
  });

  it("refuses `fetchPriority`, which `priority` decides", () => {
    // @ts-expect-error -- owned by `priority`.
    render(<OptimizedImage {...base} src="/owned-priority" fetchPriority="high" />);
    expect(screen.getByAltText(base.alt)).toBeInTheDocument();
  });

  it("refuses `srcSet`, which is built from `widths` and `formats`", () => {
    // @ts-expect-error -- owned by the builder.
    render(<OptimizedImage {...base} src="/owned-srcset" srcSet="/owned-640.jpeg 640w" />);
    expect(screen.getByAltText(base.alt)).toBeInTheDocument();
  });

  /*
   * The two required-prop refusals are asserted on the element rather than on
   * a render. Omitting the dimensions leaves nothing to reserve a box with and
   * `aspectRatioOf` throws — which is the correct runtime behaviour, covered
   * in `responsiveImage.test.ts`, and not something to re-stage through an
   * error boundary here. The claim being made is that the code does not
   * compile, and that is made by `tsc`.
   */
  it("refuses `sizes` being omitted", () => {
    // @ts-expect-error -- required; a missing `sizes` silently means 100vw.
    const element = <OptimizedImage alt="No sizes" src="/no-sizes" width={16} height={9} />;
    expect(element.type).toBe(OptimizedImage);
  });

  it("refuses the dimensions being omitted", () => {
    // @ts-expect-error -- required; `width`/`height` are the reserved box.
    const element = <OptimizedImage alt="No box" src="/no-box" sizes="100vw" />;
    expect(element.type).toBe(OptimizedImage);
  });
});
