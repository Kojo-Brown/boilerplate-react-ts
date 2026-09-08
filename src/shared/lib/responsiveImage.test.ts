import { describe, it, expect } from "vitest";
import {
  aspectRatioOf,
  buildResponsiveImage,
  buildSrcSet,
  DEFAULT_IMAGE_FORMATS,
  DEFAULT_IMAGE_WIDTHS,
  IMAGE_MIME_TYPES,
  queryImageTransform,
  ResponsiveImageError,
  type ImageTransform,
} from "@/shared/lib/responsiveImage";

const pathTransform: ImageTransform = ({ src, width, format }) => `${src}-${width}.${format}`;

describe("buildSrcSet", () => {
  it("pairs every candidate URL with its width descriptor", () => {
    expect(
      buildSrcSet({ src: "/a", widths: [320, 640], format: "avif", transform: pathTransform }),
    ).toBe("/a-320.avif 320w, /a-640.avif 640w");
  });

  it("sorts candidates ascending regardless of input order", () => {
    expect(
      buildSrcSet({ src: "/a", widths: [640, 320, 480], format: "webp", transform: pathTransform }),
    ).toBe("/a-320.webp 320w, /a-480.webp 480w, /a-640.webp 640w");
  });

  it("rejects a candidate URL containing a comma", () => {
    // A CDN spelling its transform as `w_640,c_fill` produces exactly this,
    // and the resulting attribute still parses — into two candidates that are
    // both wrong. Nothing downstream reports it, which is why it is refused
    // here rather than encoded quietly.
    const commaTransform: ImageTransform = ({ src, width }) => `${src}?tx=w_${width},c_fill`;
    expect(() =>
      buildSrcSet({ src: "/a", widths: [320], format: "avif", transform: commaTransform }),
    ).toThrow(ResponsiveImageError);
  });

  it("rejects a candidate URL containing whitespace", () => {
    const spaceTransform: ImageTransform = ({ src, width }) => `${src}/my photo-${width}.avif`;
    expect(() =>
      buildSrcSet({ src: "/a", widths: [320], format: "avif", transform: spaceTransform }),
    ).toThrow(/whitespace/);
  });

  it("rejects a non-integer width", () => {
    expect(() =>
      buildSrcSet({ src: "/a", widths: [320.5], format: "avif", transform: pathTransform }),
    ).toThrow(ResponsiveImageError);
  });

  it("rejects a zero or negative width", () => {
    expect(() =>
      buildSrcSet({ src: "/a", widths: [0], format: "avif", transform: pathTransform }),
    ).toThrow(ResponsiveImageError);
    expect(() =>
      buildSrcSet({ src: "/a", widths: [-320], format: "avif", transform: pathTransform }),
    ).toThrow(ResponsiveImageError);
  });

  it("rejects duplicate widths", () => {
    expect(() =>
      buildSrcSet({ src: "/a", widths: [320, 320], format: "avif", transform: pathTransform }),
    ).toThrow(/duplicate/);
  });

  it("rejects an empty candidate list", () => {
    expect(() =>
      buildSrcSet({ src: "/a", widths: [], format: "avif", transform: pathTransform }),
    ).toThrow(ResponsiveImageError);
  });
});

describe("buildResponsiveImage", () => {
  const built = buildResponsiveImage({
    src: "/photo",
    widths: [640, 320, 1280],
    formats: ["avif", "webp", "jpeg"],
    transform: pathTransform,
  });

  it("emits a <source> per format except the fallback, in preference order", () => {
    // Order is the whole of format negotiation: selection stops at the first
    // decodable type, so `avif` before `webp` is the difference between AVIF
    // being used and AVIF being unreachable markup.
    expect(built.sources.map((source) => source.format)).toEqual(["avif", "webp"]);
    expect(built.sources.map((source) => source.type)).toEqual([
      IMAGE_MIME_TYPES.avif,
      IMAGE_MIME_TYPES.webp,
    ]);
  });

  it("puts the last format on the <img> rather than in a <source>", () => {
    expect(built.fallback.format).toBe("jpeg");
    expect(built.fallback.srcSet).toBe(
      "/photo-320.jpeg 320w, /photo-640.jpeg 640w, /photo-1280.jpeg 1280w",
    );
  });

  it("points `src` at the largest fallback candidate", () => {
    // Read only by an engine with no `srcset` support — which also has no way
    // to ask for something better, so it gets the one that is right.
    expect(built.src).toBe("/photo-1280.jpeg");
  });

  it("offers the same widths in every format", () => {
    for (const source of [...built.sources, built.fallback]) {
      expect(source.srcSet.match(/\d+w/g)).toEqual(["320w", "640w", "1280w"]);
    }
  });

  it("supports a single-format image, where the fallback is the only entry", () => {
    const single = buildResponsiveImage({
      src: "/photo",
      widths: [320],
      formats: ["png"],
      transform: pathTransform,
    });
    expect(single.sources).toEqual([]);
    expect(single.fallback.format).toBe("png");
  });

  it("rejects a duplicated format", () => {
    // Only the first `<source>` of a type is ever consulted, so the second is
    // markup that can never be selected.
    expect(() =>
      buildResponsiveImage({
        src: "/photo",
        widths: [320],
        formats: ["avif", "avif"],
        transform: pathTransform,
      }),
    ).toThrow(/duplicate/);
  });

  it("rejects an empty format list", () => {
    expect(() =>
      buildResponsiveImage({
        src: "/photo",
        widths: [320],
        formats: [],
        transform: pathTransform,
      }),
    ).toThrow(ResponsiveImageError);
  });
});

describe("queryImageTransform", () => {
  it("appends the width and format as query parameters", () => {
    expect(queryImageTransform({ src: "/photo.jpg", width: 640, format: "avif" })).toBe(
      "/photo.jpg?w=640&fm=avif",
    );
  });

  it("produces URLs that are legal srcset candidates", () => {
    expect(() =>
      buildSrcSet({
        src: "/photo.jpg",
        widths: [...DEFAULT_IMAGE_WIDTHS],
        format: "avif",
        transform: queryImageTransform,
      }),
    ).not.toThrow();
  });
});

describe("aspectRatioOf", () => {
  it("expresses the intrinsic dimensions as a CSS ratio", () => {
    expect(aspectRatioOf(1600, 900)).toBe("1600 / 900");
  });

  it("refuses a zero dimension rather than emitting an unreservable box", () => {
    expect(() => aspectRatioOf(1600, 0)).toThrow(ResponsiveImageError);
    expect(() => aspectRatioOf(0, 900)).toThrow(ResponsiveImageError);
  });

  it("refuses a non-finite dimension", () => {
    expect(() => aspectRatioOf(Number.NaN, 900)).toThrow(ResponsiveImageError);
  });
});

describe("defaults", () => {
  it("orders the default formats best-compression first with a universal fallback", () => {
    expect(DEFAULT_IMAGE_FORMATS).toEqual(["avif", "webp", "jpeg"]);
    expect(DEFAULT_IMAGE_FORMATS.at(-1)).toBe("jpeg");
  });

  it("spaces the default widths by a roughly constant ratio", () => {
    // Selection takes the smallest candidate wide enough, so the waste between
    // neighbours is a ratio rather than a difference — evenly-spaced widths
    // over-serve the smallest screens.
    const ratios = DEFAULT_IMAGE_WIDTHS.slice(1).map(
      (width, index) => width / (DEFAULT_IMAGE_WIDTHS[index] as number),
    );
    for (const ratio of ratios) {
      expect(ratio).toBeGreaterThan(1.3);
      expect(ratio).toBeLessThan(1.5);
    }
  });

  it("offers the default widths in ascending order with no duplicates", () => {
    expect([...DEFAULT_IMAGE_WIDTHS]).toEqual(
      [...DEFAULT_IMAGE_WIDTHS].sort((a: number, b: number) => a - b),
    );
    expect(new Set(DEFAULT_IMAGE_WIDTHS).size).toBe(DEFAULT_IMAGE_WIDTHS.length);
  });
});
