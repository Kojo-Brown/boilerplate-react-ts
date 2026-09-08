import { useState, type CSSProperties, type ImgHTMLAttributes, type SyntheticEvent } from "react";
import { cn } from "@/shared/lib/cn";
import { preloadImage } from "@/shared/lib/preloadImage";
import {
  aspectRatioOf,
  buildResponsiveImage,
  DEFAULT_IMAGE_FORMATS,
  DEFAULT_IMAGE_WIDTHS,
  queryImageTransform,
  type ImageFormat,
  type ImageTransform,
} from "@/shared/lib/responsiveImage";

/**
 * The attributes this component owns.
 *
 * They are removed from the element's own props rather than merely defaulted,
 * because every one of them is a decision the component makes from `priority`,
 * `widths` and `formats` — and a caller who passes `loading="lazy"` alongside
 * `priority` is describing two different intentions, of which the spread order
 * would silently pick one. Removing them turns that into a type error.
 */
type OwnedAttributes =
  | "src"
  | "srcSet"
  | "sizes"
  | "width"
  | "height"
  | "loading"
  | "decoding"
  | "fetchPriority"
  | "placeholder";

export interface OptimizedImageProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  OwnedAttributes
> {
  /** The image's identity, before a width or format is applied. */
  src: string;
  alt: string;
  /**
   * Intrinsic dimensions. **Required**, and required together: they are the
   * only thing that can reserve the box, and an image component that can be
   * rendered without them is a component that can be rendered un-reservedly.
   * That is the entire CLS story — see {@link aspectRatioOf}.
   */
  width: number;
  height: number;
  /**
   * The layout width, as a media-condition list.
   *
   * Required for the same reason as the dimensions: `srcset` with `w`
   * descriptors and no `sizes` means `100vw`, and there is no warning for the
   * over-fetch that follows. Making it optional would make the wrong answer
   * the easy one.
   */
  sizes: string;
  /** Candidate intrinsic widths. Defaults to {@link DEFAULT_IMAGE_WIDTHS}. */
  widths?: readonly number[];
  /** Formats, **best first**. Defaults to {@link DEFAULT_IMAGE_FORMATS}. */
  formats?: readonly ImageFormat[];
  /** How a (src, width, format) triple becomes a URL. */
  transform?: ImageTransform;
  /**
   * Overrides the reserved ratio when the rendered crop is not the intrinsic
   * one — a 3:2 photograph shown in a square tile. Without it the ratio comes
   * from `width` and `height`.
   */
  aspectRatio?: string;
  /** A tiny inline placeholder painted behind the image while it loads. */
  blurDataURL?: string;
  /**
   * Marks this as the image the page is about: eager, `fetchpriority="high"`,
   * preloaded, decoded with the frame, and never faded in.
   *
   * At most one per view. The hint is a ranking, so marking everything high
   * ranks nothing.
   */
  priority?: boolean;
  /** Classes for the reserved box. */
  className?: string;
  /** Classes for the `<img>` itself. */
  imgClassName?: string;
}

/**
 * A `<picture>` that reserves its space, offers modern formats, and says out
 * loud which image the page is about.
 *
 * Three things, none of which compose by accident:
 *
 * **Format negotiation** is `<source type>` in preference order, and the order
 * is load-bearing — the browser takes the first type it can decode, so a
 * fallback listed early makes everything after it unreachable markup.
 *
 * **Priority** is four attributes that have to agree. `loading="lazy"` on an
 * in-viewport image defers its request behind layout; `fetchpriority="high"`
 * moves it up the queue once found; a preload starts it before React has
 * committed anything; and `decoding="async"` lets the browser present a frame
 * without the image and decode it later, which for the LCP candidate is the
 * one frame you were trying to hit. `priority` sets all four together because
 * setting three of them is indistinguishable from setting none.
 *
 * The fourth is the fade-in, and it is the reason `priority` disables it: an
 * element at `opacity: 0` has not painted, so a fade-in does not make the LCP
 * image arrive smoothly — it postpones the image being an LCP candidate at all
 * until the transition begins, and then reports the metric against the
 * transition rather than the network. A decorative image can afford that; the
 * one the page is about cannot.
 *
 * **The reserved box** is the wrapper's `aspect-ratio`, not the `<img>`'s
 * `width`/`height` attributes. The attributes are still set — they are what an
 * unstyled or stylesheet-less render falls back to — but the fitted `<img>`
 * inside is `h-full w-full`, and CSS setting both axes overrides the UA's
 * intrinsic ratio completely. Whatever holds the space has to be the element
 * CSS is not overriding, which is the wrapper.
 *
 * See `docs/image-pipeline.md`.
 */
export function OptimizedImage({
  src,
  alt,
  width,
  height,
  sizes,
  widths = DEFAULT_IMAGE_WIDTHS,
  formats = DEFAULT_IMAGE_FORMATS,
  transform = queryImageTransform,
  aspectRatio,
  blurDataURL,
  priority = false,
  className,
  imgClassName,
  onLoad,
  onError,
  ...rest
}: OptimizedImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  const built = buildResponsiveImage({ src, widths, formats, transform });

  if (priority) {
    // Called during render, which is where React documents it: the link is
    // appended to `<head>` on the spot rather than in an effect that runs
    // after the commit this is trying to get ahead of. It is idempotent — see
    // the dedupe note in `preloadImage`.
    preloadImage({ src, widths, formats, transform, sizes });
  }

  function handleLoad(event: SyntheticEvent<HTMLImageElement>) {
    setIsLoaded(true);
    onLoad?.(event);
  }

  function handleError(event: SyntheticEvent<HTMLImageElement>) {
    setHasError(true);
    onError?.(event);
  }

  const boxStyle: CSSProperties = {
    aspectRatio: aspectRatio ?? aspectRatioOf(width, height),
    // `max-width` rather than `width`. A fixed pixel width would make the
    // element refuse to shrink below its intrinsic size, overflowing every
    // viewport narrower than the source — and it would flatten the layout
    // width that `sizes` describes to a constant, which is the input the whole
    // candidate list is chosen by.
    maxWidth: `${width}px`,
    width: "100%",
  };

  const showPlaceholder = blurDataURL !== undefined && !isLoaded && !hasError;
  const fadeIn = !priority && !isLoaded && !hasError;

  return (
    <div className={cn("relative overflow-hidden", className)} style={boxStyle}>
      {showPlaceholder && (
        <img
          src={blurDataURL}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl"
        />
      )}

      <picture className="block h-full w-full">
        {built.sources.map((source) => (
          // `sizes` is repeated on every candidate list rather than set once
          // on the `<img>`. Each `<source>` resolves its own `srcset` against
          // its own `sizes`, and an omitted one is `100vw` — so the element
          // that ends up selected is the one place it must not be missing.
          <source key={source.format} type={source.type} srcSet={source.srcSet} sizes={sizes} />
        ))}
        <img
          src={built.src}
          srcSet={built.fallback.srcSet}
          sizes={sizes}
          alt={alt}
          width={width}
          height={height}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding={priority ? "sync" : "async"}
          onLoad={handleLoad}
          onError={handleError}
          className={cn(
            "h-full w-full object-cover",
            !priority && "transition-opacity duration-[var(--duration-slow)]",
            fadeIn ? "opacity-0" : "opacity-100",
            imgClassName,
          )}
          {...rest}
        />
      </picture>

      {hasError && (
        <div
          role="img"
          aria-label={`Failed to load: ${alt}`}
          className="absolute inset-0 flex items-center justify-center bg-[var(--color-muted)] text-[var(--color-muted-fg)]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-8 w-8 opacity-50"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
      )}
    </div>
  );
}
