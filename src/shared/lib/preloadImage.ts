import { preload } from "react-dom";
import {
  buildResponsiveImage,
  type ResponsiveImageInput,
  type ImageSource,
} from "@/shared/lib/responsiveImage";

/**
 * Emits `<link rel="preload" as="image">` for a responsive image.
 *
 * `fetchpriority="high"` reorders a request the browser has already found.
 * This is the other half: it starts one it has not. In an application whose
 * markup is built by JavaScript there is no server-sent HTML for the preload
 * scanner to read, so the LCP image is discovered when React commits the
 * `<img>` — after the entry chunk has been fetched, parsed and run. A preload
 * called from a route module, or from a parent that renders while its children
 * are still suspended, moves that discovery earlier by however long the work
 * in between takes.
 *
 * ## Only the first format, and always with a `type`
 *
 * A preload that does not match what `<picture>` selects is not a wasted hint,
 * it is a **second download**. Three things make one preload correct for a
 * multi-format image:
 *
 * - The preload carries `type`, so a browser that cannot decode AVIF drops it
 *   — and that is precisely the browser that will not select the AVIF
 *   `<source>` either. The hint disappears exactly where it would have been
 *   wrong.
 * - Only the *first* format is preloaded. Emitting one per format would double
 *   -download in every browser that supports two of them, which today is most
 *   of them.
 * - `imageSrcSet` and `imageSizes` are passed through verbatim from the same
 *   builder the element uses. Preload candidate selection runs the same
 *   algorithm as the element's, so identical inputs are what make the two
 *   resolve to one URL and one request.
 *
 * ## What React does with `href`
 *
 * It throws it away. `preload` requires an `href` argument, but for
 * `as: "image"` with an `imageSrcSet` React sets `href: undefined` on the link
 * it creates — the candidate list is the address. So the value passed here is
 * unobservable in the DOM, and the hope that "at least the fallback gets
 * preloaded" is not something this API can express. It also keys its dedupe on
 * `imagesrcset` + `imagesizes`, which is what makes calling this twice for one
 * image — a StrictMode double render, or a parent and its child both asking —
 * produce a single link rather than two.
 *
 * Deliberately not gated on Save-Data. This preloads the image the page is
 * *about*, not a guess about where the user is going next; declining to fetch
 * it does not save the bytes, it only spends them later. Speculative loading
 * is what {@link "@/shared/lib/dataSaver"} exists to hold back.
 */
export function preloadImage(
  input: ResponsiveImageInput & { readonly sizes: string; readonly fetchPriority?: "high" | "low" },
): void {
  const built = buildResponsiveImage(input);
  // The first `<source>`, or the `<img>` itself when only one format is
  // offered — either way, the candidate list selection will reach first.
  const best: ImageSource = built.sources[0] ?? built.fallback;

  preload(built.src, {
    as: "image",
    type: best.type,
    imageSrcSet: best.srcSet,
    imageSizes: input.sizes,
    fetchPriority: input.fetchPriority ?? "high",
  });
}
