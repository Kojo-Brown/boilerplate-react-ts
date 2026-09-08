/**
 * The URL arithmetic behind a `<picture>`: which formats, which widths, and
 * the two strings — `srcset` and `sizes` — that decide what actually gets
 * downloaded.
 *
 * It is separated from {@link "@/shared/ui/OptimizedImage"} because every
 * mistake worth catching here is a string mistake, and a string is far easier
 * to assert on than a rendered `<picture>`. Nothing in this module touches the
 * DOM.
 *
 * Three rules the browser applies, which the rest of this file exists to keep
 * on the right side of:
 *
 * 1. **The first matching `<source>` wins.** Selection walks the children in
 *    document order and stops at the first `type` the engine can decode — it
 *    does not compare file sizes, and it never revisits. So the order of
 *    {@link ResponsiveImageInput.formats} *is* the preference order, smallest
 *    format first, and a fallback listed early makes every format after it
 *    dead markup that still looks correct in review.
 * 2. **`srcset` without `sizes` means `100vw`.** A `w` descriptor is a claim
 *    about the candidate's intrinsic width, not about the layout, so the
 *    browser needs the layout width to pick between them. Absent `sizes` it
 *    assumes the image fills the viewport, which for a three-up grid is a
 *    roughly 3× over-fetch that no test and no console message reports.
 * 3. **`srcset` is comma-separated.** A candidate URL containing a comma
 *    splits into two malformed candidates. CDNs reach for commas constantly
 *    (`?tx=w_640,c_fill`), so {@link buildSrcSet} refuses one rather than
 *    emitting a list that parses into something else.
 */

/** The formats this pipeline can emit, best-compression first. */
export type ImageFormat = "avif" | "webp" | "jpeg" | "png";

/**
 * The MIME type each format is announced as.
 *
 * This is the whole of format negotiation: the browser reads `type` and
 * decides, before a single byte is requested, whether it could decode what is
 * behind the URL. It never sniffs the response to find out it guessed wrong,
 * which is why a mislabelled `<source>` is a hard failure rather than a slow
 * path — and why a fixture serving one format's bytes from another format's
 * URL still exercises selection faithfully.
 */
export const IMAGE_MIME_TYPES = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
  png: "image/png",
} as const satisfies Record<ImageFormat, string>;

/**
 * Turns one (source, width, format) triple into a URL.
 *
 * A port rather than a hardcoded scheme, because this is the one part of the
 * pipeline that is entirely determined by whoever serves the bytes — imgix
 * wants `?w=`, Cloudinary wants a path segment, a build-time pipeline wants a
 * content hash. Everything else in this module is the same regardless.
 */
export type ImageTransform = (input: {
  readonly src: string;
  readonly width: number;
  readonly format: ImageFormat;
}) => string;

/** One `<source>`: a MIME type and the candidates offered under it. */
export interface ImageSource {
  readonly format: ImageFormat;
  readonly type: string;
  readonly srcSet: string;
}

export interface ResponsiveImageInput {
  /** The identity of the image, before any width or format is applied. */
  readonly src: string;
  /** Intrinsic widths to offer, in any order. Deduplicated and sorted. */
  readonly widths: readonly number[];
  /** Formats to offer, **best first**. The last one is the fallback. */
  readonly formats: readonly ImageFormat[];
  readonly transform: ImageTransform;
}

export interface ResponsiveImage {
  /**
   * The `<source>` elements, in the order they must be rendered.
   *
   * Excludes the fallback format: it belongs on the `<img>` itself, which is
   * both the last candidate and the element every other attribute hangs off.
   */
  readonly sources: readonly ImageSource[];
  /** The fallback format's candidates, for the `<img>`'s own `srcset`. */
  readonly fallback: ImageSource;
  /**
   * The `<img>`'s `src`.
   *
   * The largest fallback candidate. Any engine that understands `srcset`
   * ignores this attribute entirely, so it is read only by one that does not —
   * and an engine with no `srcset` also has no way to ask for something
   * better, so it gets the version that is right rather than the one that is
   * cheap.
   */
  readonly src: string;
}

/** Thrown for an input that would produce a `srcset` the browser misreads. */
export class ResponsiveImageError extends Error {
  override name = "ResponsiveImageError";
}

function assertWidths(widths: readonly number[]): readonly number[] {
  if (widths.length === 0) {
    throw new ResponsiveImageError("`widths` must offer at least one candidate.");
  }
  for (const width of widths) {
    if (!Number.isInteger(width) || width <= 0) {
      throw new ResponsiveImageError(
        `Width ${width} is not a positive integer. A malformed \`w\` descriptor invalidates its candidate silently.`,
      );
    }
  }
  const unique = [...new Set(widths)];
  if (unique.length !== widths.length) {
    throw new ResponsiveImageError(
      `\`widths\` contains a duplicate: [${widths.join(", ")}]. Two candidates at one width give the browser no way to choose.`,
    );
  }
  // Ascending, so the candidate list reads in the order the selection
  // algorithm considers it. Nothing in the spec requires it — but a
  // hand-written list is reviewed by eye, and an unsorted one hides its own
  // gaps.
  return [...unique].sort((a: number, b: number) => a - b);
}

function assertFormats(formats: readonly ImageFormat[]): void {
  if (formats.length === 0) {
    throw new ResponsiveImageError("`formats` must offer at least one format.");
  }
  if (new Set(formats).size !== formats.length) {
    throw new ResponsiveImageError(
      `\`formats\` contains a duplicate: [${formats.join(", ")}]. Only the first \`<source>\` of a type is ever consulted.`,
    );
  }
}

/**
 * A candidate list for one format.
 *
 * Rejects a URL carrying a comma or whitespace. Both are separators inside a
 * `srcset`, so either one turns a single candidate into two broken ones — and
 * the failure is invisible: the attribute is still present, the image still
 * loads from `src`, and the responsive behaviour is simply gone.
 */
export function buildSrcSet(
  input: Omit<ResponsiveImageInput, "formats"> & { readonly format: ImageFormat },
): string {
  const widths = assertWidths(input.widths);
  return widths
    .map((width) => {
      const url = input.transform({ src: input.src, width, format: input.format });
      if (/[,\s]/.test(url)) {
        throw new ResponsiveImageError(
          `Candidate URL "${url}" contains a comma or whitespace, which separates entries in a srcset. Percent-encode it (%2C, %20) in the transform.`,
        );
      }
      return `${url} ${width}w`;
    })
    .join(", ");
}

/** Builds every `<source>` plus the `<img>` fallback, in render order. */
export function buildResponsiveImage(input: ResponsiveImageInput): ResponsiveImage {
  const widths = assertWidths(input.widths);
  assertFormats(input.formats);

  const all = input.formats.map<ImageSource>((format) => ({
    format,
    type: IMAGE_MIME_TYPES[format],
    srcSet: buildSrcSet({ ...input, widths, format }),
  }));

  // `formats` is non-empty (assertFormats), so both of these exist; the index
  // signature under `noUncheckedIndexedAccess` cannot know that.
  const fallback = all.at(-1) as ImageSource;
  const largest = widths.at(-1) as number;

  return {
    sources: all.slice(0, -1),
    fallback,
    src: input.transform({ src: input.src, width: largest, format: fallback.format }),
  };
}

/**
 * The wrapper's `aspect-ratio`.
 *
 * `width` and `height` on an `<img>` already give the browser an intrinsic
 * ratio to reserve space with — but only while CSS leaves one axis alone. A
 * responsive image is `width: 100%` with `height: auto`, and the moment a
 * stylesheet sets both (`h-full w-full`, as the fitted `<img>` here does) the
 * UA's ratio is overridden and the attributes reserve nothing. The box the
 * layout actually holds open therefore has to be the wrapper's, and this is
 * the number it holds.
 */
export function aspectRatioOf(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new ResponsiveImageError(
      `Cannot reserve a box for ${width}×${height}: both dimensions must be positive.`,
    );
  }
  return `${width} / ${height}`;
}

/**
 * The default transform: width and format as query parameters.
 *
 * Not because any particular CDN spells it this way, but because it is the
 * spelling that survives being wrong — an origin that ignores the query still
 * returns the original image, so a misconfigured deployment degrades to
 * "unoptimised" rather than to 404s across every candidate.
 */
export const queryImageTransform: ImageTransform = ({ src, width, format }) =>
  `${src}?w=${width}&fm=${format}`;

/** Formats offered by default, in the order a browser should prefer them. */
export const DEFAULT_IMAGE_FORMATS: readonly ImageFormat[] = ["avif", "webp", "jpeg"];

/**
 * Candidate widths offered by default.
 *
 * Spaced by roughly 1.4× rather than evenly. Selection picks the smallest
 * candidate at least as wide as it needs, so what matters is the worst-case
 * overshoot between neighbours, and that is a ratio — evenly-spaced widths
 * waste bytes at the bottom of the range, where the users on the smallest
 * screens are.
 */
export const DEFAULT_IMAGE_WIDTHS: readonly number[] = [320, 448, 640, 896, 1280, 1792, 2560];
